import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddExternalPaymentIdPartialUniqueIndex1779124406848 implements MigrationInterface {
  name = 'AddExternalPaymentIdPartialUniqueIndex1779124406848';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "payments_external_payment_id_unique_idx" ` +
        `ON "payments" ("external_payment_id") ` +
        `WHERE "external_payment_id" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "payments_external_payment_id_unique_idx"`,
    );
  }
}
