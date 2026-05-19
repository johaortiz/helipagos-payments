import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

// Partial unique index: allows multiple NULL rows while enforcing uniqueness
// for any non-null provider ID (Helipagos id_sp).
@Index('payments_external_payment_id_unique_idx', ['externalPaymentId'], {
  unique: true,
  where: '"external_payment_id" IS NOT NULL',
})
@Entity('payments')
export class PaymentOrmEntity {
  @PrimaryColumn('uuid')
  id!: string;

  @Column({ type: 'int', nullable: true, name: 'external_payment_id' })
  externalPaymentId!: number | null;

  @Column({ type: 'varchar', unique: true, name: 'external_reference' })
  externalReference!: string;

  @Column({ type: 'bigint', name: 'amount' })
  amount!: number;

  @Column({ type: 'varchar' })
  description!: string;

  @Column({ type: 'varchar' })
  status!: string;

  @Column({ type: 'varchar', name: 'expiration_date' })
  expirationDate!: string;

  @Column({ type: 'text', nullable: true, name: 'checkout_url' })
  checkoutUrl!: string | null;

  @Column({ type: 'text', nullable: true, name: 'short_url' })
  shortUrl!: string | null;

  @Column({ type: 'text', nullable: true, name: 'bar_code' })
  barCode!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
