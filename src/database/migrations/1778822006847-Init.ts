import { MigrationInterface, QueryRunner } from 'typeorm';

export class Init1778822006847 implements MigrationInterface {
  name = 'Init1778822006847';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "payments" ("id" uuid NOT NULL, "external_payment_id" integer, "external_reference" character varying NOT NULL, "amount" bigint NOT NULL, "description" character varying NOT NULL, "status" character varying NOT NULL, "expiration_date" character varying NOT NULL, "checkout_url" text, "short_url" text, "bar_code" text, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_c2df87117d79717954e660b4984" UNIQUE ("external_reference"), CONSTRAINT "PK_197ab7af18c93fbb0c9b28b4a59" PRIMARY KEY ("id"))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "payments"`);
  }
}
