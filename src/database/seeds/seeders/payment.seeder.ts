import { DataSource } from 'typeorm';

import { PaymentOrmEntity } from '../../../contexts/payments/infrastructure/persistence/entities/payment.orm-entity';
import { PAYMENT_SEED_DATA } from '../data/payment-seed.data';

export class PaymentSeeder {
  constructor(private readonly dataSource: DataSource) {}

  async run(): Promise<void> {
    process.stdout.write('  [PaymentSeeder] Seeding payments... ');

    const result = await this.dataSource
      .createQueryBuilder()
      .insert()
      .into(PaymentOrmEntity)
      .values(PAYMENT_SEED_DATA)
      // ON CONFLICT (external_reference) DO NOTHING — fully idempotent.
      // Re-running the seed never overwrites manually edited records.
      .orIgnore()
      .execute();

    // PostgreSQL returns identifiers only for rows actually inserted.
    const inserted = result.identifiers.length;
    const skipped = PAYMENT_SEED_DATA.length - inserted;

    console.log(`${inserted} inserted, ${skipped} skipped (already exist).`);
  }
}
