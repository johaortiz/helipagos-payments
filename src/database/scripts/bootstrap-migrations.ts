/**
 * bootstrap-migrations.ts
 *
 * Safe migration bootstrap for Railway / production first deploys.
 *
 * ── Problem ────────────────────────────────────────────────────────────────────
 * The payments table may already exist in the production database (created by a
 * previous deploy that used TypeORM synchronize or manual DDL).  When that
 * happens, running `pnpm migration:run` fails because the Init migration tries
 * to CREATE TABLE payments — which already exists.
 *
 * ── Decision tree ──────────────────────────────────────────────────────────────
 *
 *  1. payments table does NOT exist
 *     → run migrations from scratch (normal TypeORM path).
 *
 *  2. payments table exists AND Init migration is already recorded
 *     → run pending migrations (normal TypeORM path, nothing special needed).
 *
 *  3. payments table exists AND Init migration is NOT recorded
 *     a. Validate the existing schema against the expected columns + constraints.
 *     b. If valid   → insert the Init migration baseline record, then run pending
 *                      migrations so any newer migrations still execute.
 *     c. If invalid → abort with a descriptive error.  No data is modified.
 *
 * ── Usage ──────────────────────────────────────────────────────────────────────
 *
 *   Railway first deploy:
 *     pnpm migration:bootstrap
 *
 *   Normal deploys (after baseline is established):
 *     pnpm migration:run
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables before importing typeorm.config, which reads
// process.env at module evaluation time.
const NODE_ENV = process.env.NODE_ENV ?? 'development';
dotenv.config({ path: path.resolve(process.cwd(), `.env.${NODE_ENV}`) });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

import { DataSource } from 'typeorm';

import dataSource from '../typeorm.config';

// ── Initial migration identity ────────────────────────────────────────────────
// Source: src/database/migrations/1778822006847-Init.ts
// These values must stay in sync with the migration file they represent.

const INIT_MIGRATION_TIMESTAMP = 1778822006847;
const INIT_MIGRATION_NAME = 'Init1778822006847';

// ── Column validation ─────────────────────────────────────────────────────────

/**
 * Minimum columns expected in the payments table.
 * This list reflects the schema created by the Init migration.
 */
export const EXPECTED_PAYMENTS_COLUMNS = [
  'id',
  'external_payment_id',
  'external_reference',
  'amount',
  'description',
  'status',
  'expiration_date',
  'checkout_url',
  'short_url',
  'bar_code',
  'created_at',
  'updated_at',
] as const;

export interface ColumnRow {
  column_name: string;
  data_type: string;
}

/**
 * Validates that all expected columns are present in the payments table rows
 * returned from information_schema.columns.
 *
 * Pure function — no database access.  Exported for unit testing.
 */
export function validatePaymentsSchema(columns: ColumnRow[]): {
  valid: boolean;
  missing: string[];
} {
  const found = new Set(columns.map((c) => c.column_name));
  const missing = (EXPECTED_PAYMENTS_COLUMNS as readonly string[]).filter(
    (col) => !found.has(col),
  );
  return { valid: missing.length === 0, missing };
}

// ── Database helpers ──────────────────────────────────────────────────────────

/**
 * Typed wrapper around DataSource.query() whose return type is `Promise<any>`.
 * Funnelling through `unknown` satisfies ESLint's no-unsafe-assignment /
 * no-unsafe-member-access rules while keeping call sites concise.
 */
async function runQuery<T>(
  ds: DataSource,
  sql: string,
  params?: unknown[],
): Promise<T> {
  const raw: unknown = await ds.query(sql, params);
  return raw as T;
}

async function tableExists(
  ds: DataSource,
  tableName: string,
): Promise<boolean> {
  const rows = await runQuery<Array<{ exists: boolean }>>(
    ds,
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = $1
     ) AS "exists"`,
    [tableName],
  );
  return rows[0]?.exists === true;
}

async function initMigrationRecorded(ds: DataSource): Promise<boolean> {
  const rows = await runQuery<Array<{ count: string }>>(
    ds,
    `SELECT COUNT(*) AS count FROM "migrations" WHERE name = $1`,
    [INIT_MIGRATION_NAME],
  );
  return parseInt(rows[0]?.count ?? '0', 10) > 0;
}

async function ensureMigrationsTable(ds: DataSource): Promise<void> {
  await runQuery<void>(
    ds,
    `
    CREATE TABLE IF NOT EXISTS "migrations" (
      "id"        SERIAL            NOT NULL,
      "timestamp" bigint            NOT NULL,
      "name"      character varying NOT NULL,
      CONSTRAINT "PK_migrations_bootstrap" PRIMARY KEY ("id")
    )
  `,
  );
}

async function hasUniqueConstraintOnColumn(
  ds: DataSource,
  tableName: string,
  columnName: string,
): Promise<boolean> {
  const rows = await runQuery<Array<{ count: string }>>(
    ds,
    `SELECT COUNT(*) AS count
     FROM information_schema.table_constraints tc
     JOIN information_schema.constraint_column_usage ccu
       ON  tc.constraint_name = ccu.constraint_name
       AND tc.table_schema    = ccu.table_schema
     WHERE tc.table_schema    = 'public'
       AND tc.table_name      = $1
       AND tc.constraint_type = 'UNIQUE'
       AND ccu.column_name    = $2`,
    [tableName, columnName],
  );
  return parseInt(rows[0]?.count ?? '0', 10) > 0;
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

async function bootstrap(): Promise<void> {
  await dataSource.initialize();
  console.log('[bootstrap] DataSource initialized.');

  try {
    // ── 1. payments table does not exist → run migrations from scratch ─────────
    const paymentsExists = await tableExists(dataSource, 'payments');

    if (!paymentsExists) {
      console.log(
        '[bootstrap] payments table not found — running migrations from scratch.',
      );
      await dataSource.runMigrations({ transaction: 'each' });
      console.log('[bootstrap] All migrations complete.');
      return;
    }

    console.log('[bootstrap] payments table already exists.');

    // ── 2. Init migration already recorded → nothing special ───────────────────
    const migrationsTablePresent = await tableExists(dataSource, 'migrations');

    if (migrationsTablePresent && (await initMigrationRecorded(dataSource))) {
      console.log(
        `[bootstrap] Init migration already recorded — running pending migrations.`,
      );
      await dataSource.runMigrations({ transaction: 'each' });
      console.log('[bootstrap] All migrations complete.');
      return;
    }

    // ── 3. payments exists but Init not recorded → validate then baseline ──────
    console.log(
      '[bootstrap] Init migration not yet recorded — validating existing schema.',
    );

    const columns = await runQuery<ColumnRow[]>(
      dataSource,
      `SELECT column_name, data_type
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'payments'
       ORDER BY ordinal_position`,
    );

    const { valid, missing } = validatePaymentsSchema(columns);

    if (!valid) {
      throw new Error(
        `[bootstrap] Schema validation failed: payments table is missing ` +
          `expected columns: ${missing.join(', ')}.\n` +
          `Aborting to prevent data corruption. Inspect the table manually ` +
          `and resolve the discrepancy before running migrations.`,
      );
    }

    const hasUniqueRef = await hasUniqueConstraintOnColumn(
      dataSource,
      'payments',
      'external_reference',
    );

    if (!hasUniqueRef) {
      throw new Error(
        `[bootstrap] Schema validation failed: payments.external_reference ` +
          `does not have a UNIQUE constraint.\n` +
          `Aborting to prevent data corruption. Inspect the table manually ` +
          `before proceeding.`,
      );
    }

    console.log('[bootstrap] Schema validation passed.');

    // ── 4. Insert Init migration baseline record ───────────────────────────────
    await ensureMigrationsTable(dataSource);
    await runQuery<void>(
      dataSource,
      `INSERT INTO "migrations" (timestamp, name) VALUES ($1, $2)`,
      [INIT_MIGRATION_TIMESTAMP, INIT_MIGRATION_NAME],
    );
    console.log(
      `[bootstrap] Baselined: ${INIT_MIGRATION_NAME} (timestamp: ${INIT_MIGRATION_TIMESTAMP})`,
    );

    // ── 5. Run any remaining pending migrations (e.g. AddExternalPaymentIdPartialUniqueIndex)
    await dataSource.runMigrations({ transaction: 'each' });
    console.log('[bootstrap] All migrations complete.');
  } finally {
    await dataSource.destroy().catch((err: unknown) => {
      console.error(
        '[bootstrap] Failed to close DataSource:',
        err instanceof Error ? err.message : err,
      );
    });
    console.log('[bootstrap] DataSource closed.');
  }
}

// Run only when this file is executed directly (not when imported by tests).
if (require.main === module) {
  bootstrap().catch((err: unknown) => {
    console.error(
      '[bootstrap] FATAL:',
      err instanceof Error ? err.message : err,
    );
    process.exit(1);
  });
}
