import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import { Payment } from '../../../domain/entities/payment.entity';
import { PaymentStatus } from '../../../domain/enums/payment-status.enum';
import { PaymentRepository } from '../../../domain/repositories/payment.repository';
import { PaymentOrmEntity } from '../entities/payment.orm-entity';

@Injectable()
export class TypeOrmPaymentRepository extends PaymentRepository {
  constructor(
    @InjectRepository(PaymentOrmEntity)
    private readonly repository: Repository<PaymentOrmEntity>,
    private readonly dataSource: DataSource,
  ) {
    super();
  }

  async save(payment: Payment): Promise<void> {
    await this.repository.save(this.toOrm(payment));
  }

  async update(payment: Payment): Promise<void> {
    await this.repository.save(this.toOrm(payment));
  }

  async findById(id: string): Promise<Payment | null> {
    const orm = await this.repository.findOne({ where: { id } });
    return orm ? this.toDomain(orm) : null;
  }

  /**
   * Acquires a pessimistic write lock (SELECT FOR UPDATE) inside a short
   * transaction. In a scenario where the lock must span the full read-update
   * cycle, consider passing a QueryRunner as context instead.
   */
  async findByIdForUpdate(id: string): Promise<Payment | null> {
    return this.dataSource.transaction(async (manager) => {
      const orm = await manager.findOne(PaymentOrmEntity, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      return orm ? this.toDomain(orm) : null;
    });
  }

  async findByExternalReference(
    externalReference: string,
  ): Promise<Payment | null> {
    const orm = await this.repository.findOne({ where: { externalReference } });
    return orm ? this.toDomain(orm) : null;
  }

  async findByExternalPaymentId(
    externalPaymentId: number,
  ): Promise<Payment | null> {
    const orm = await this.repository.findOne({ where: { externalPaymentId } });
    return orm ? this.toDomain(orm) : null;
  }

  async existsByExternalReference(externalReference: string): Promise<boolean> {
    const count = await this.repository.count({ where: { externalReference } });
    return count > 0;
  }

  async findByExternalPaymentIdForUpdate(
    externalPaymentId: number,
  ): Promise<Payment | null> {
    return this.dataSource.transaction(async (manager) => {
      const orm = await manager.findOne(PaymentOrmEntity, {
        where: { externalPaymentId },
        lock: { mode: 'pessimistic_write' },
      });
      return orm ? this.toDomain(orm) : null;
    });
  }

  async processByExternalPaymentIdForUpdate(
    externalPaymentId: number,
    handler: (payment: Payment) => boolean | Promise<boolean>,
  ): Promise<Payment | null> {
    return this.dataSource.transaction(async (manager) => {
      const orm = await manager.findOne(PaymentOrmEntity, {
        where: { externalPaymentId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!orm) return null;
      const payment = this.toDomain(orm);
      const shouldSave = await handler(payment);
      if (shouldSave) {
        await manager.save(PaymentOrmEntity, this.toOrm(payment));
      }
      return payment;
    });
  }

  // ─── Mappers ───────────────────────────────────────────────────────────────

  private toDomain(orm: PaymentOrmEntity): Payment {
    return new Payment({
      id: orm.id,
      externalPaymentId: orm.externalPaymentId,
      externalReference: orm.externalReference,
      // bigint columns are returned as string by PostgreSQL drivers
      amount: Number(orm.amount),
      description: orm.description,
      status: orm.status as PaymentStatus,
      // date columns may be returned as string depending on the driver config
      expirationDate: orm.expirationDate,
      checkoutUrl: orm.checkoutUrl,
      shortUrl: orm.shortUrl,
      barCode: orm.barCode,
      createdAt: orm.createdAt,
      updatedAt: orm.updatedAt,
    });
  }

  private toOrm(payment: Payment): PaymentOrmEntity {
    const orm = new PaymentOrmEntity();
    orm.id = payment.id;
    orm.externalPaymentId = payment.externalPaymentId;
    orm.externalReference = payment.externalReference;
    orm.amount = payment.amount;
    orm.description = payment.description;
    orm.status = payment.status;
    orm.expirationDate = payment.expirationDate;
    orm.checkoutUrl = payment.checkoutUrl;
    orm.shortUrl = payment.shortUrl;
    orm.barCode = payment.barCode;
    orm.createdAt = payment.createdAt;
    orm.updatedAt = payment.updatedAt;
    return orm;
  }
}
