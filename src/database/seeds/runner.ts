/**
 * Seed runner — orchestrates all seeders in dependency order.
 *
 * Safety:  Aborts when NODE_ENV=production to prevent accidental data
 *          pollution in live databases.  Override with SEED_FORCE=true
 *          only when you genuinely intend to seed a production DB.
 *
 * Usage:
 *   pnpm seed                        # loads .env.development then .env
 *   NODE_ENV=staging pnpm seed       # loads .env.staging then .env
 */
import * as dotenv from 'dotenv';
import * as path from 'path';

// Resolve NODE_ENV before dotenv so we can pick the right file.
// Priority: .env.<NODE_ENV>  →  .env  (later calls never overwrite earlier ones)
const NODE_ENV_EARLY = process.env.NODE_ENV ?? 'development';
dotenv.config({ path: path.resolve(process.cwd(), `.env.${NODE_ENV_EARLY}`) });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

import { DataSource } from 'typeorm';

import { PaymentOrmEntity } from '../../contexts/payments/infrastructure/persistence/entities/payment.orm-entity';
import { PaymentSeeder } from './seeders/payment.seeder';
import { UserSeeder } from './seeders/user.seeder';

// ─── Production guard

const NODE_ENV = process.env.NODE_ENV ?? 'development';
const SEED_FORCE = process.env.SEED_FORCE === 'true';

if (NODE_ENV === 'production' && !SEED_FORCE) {
  console.error(
    '\n[Seed] Refusing to run in production environment.\n' +
      '       Set SEED_FORCE=true to override (use with extreme caution).\n',
  );
  process.exit(1);
}

// ─── DataSource

const dataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 5432),
  username: process.env.DB_USERNAME ?? 'postgres',
  password: process.env.DB_PASSWORD ?? 'postgres',
  database: process.env.DB_NAME ?? 'helipagos',
  entities: [PaymentOrmEntity],
  synchronize: false,
  logging: false,
});

// ─── Runner

async function run(): Promise<void> {
  const db = dataSource.options.database as string;

  console.log(
    `\n[Seed] Environment : ${NODE_ENV}` +
      `\n[Seed] Database    : ${db}` +
      `\n[Seed] Starting...\n`,
  );

  await dataSource.initialize();

  try {
    new UserSeeder().run();
    await new PaymentSeeder(dataSource).run();

    console.log('[Seed] All seeders completed successfully.\n');
  } finally {
    await dataSource.destroy();
  }
}

run().catch((err: unknown) => {
  console.error('\n[Seed] Fatal error:', err);
  process.exit(1);
});
