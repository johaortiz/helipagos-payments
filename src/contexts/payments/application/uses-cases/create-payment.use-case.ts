import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';

import { Payment } from '../../domain/entities/payment.entity';
import { PaymentStatus } from '../../domain/enums/payment-status.enum';
import { PaymentProviderGateway } from '../../domain/gateways/payment-provider.gateway';
import { PaymentRepository } from '../../domain/repositories/payment.repository';
import { CreatePaymentInput } from '../dto/create-payment.input';
import { CreatePaymentOutput } from '../dto/create-payment.output';

@Injectable()
export class CreatePaymentUseCase {
  constructor(
    private readonly paymentRepository: PaymentRepository,
    private readonly providerGateway: PaymentProviderGateway,
  ) {}

  async execute(input: CreatePaymentInput): Promise<CreatePaymentOutput> {
    // ── Idempotency check ─────────────────────────────────────────────────────
    const exists = await this.paymentRepository.existsByExternalReference(
      input.externalReference,
    );

    if (exists) {
      const existing = await this.paymentRepository.findByExternalReference(
        input.externalReference,
      );
      return this.toOutput(existing!);
    }

    // ── Create Payment in PENDING state ───────────────────────────────────────
    const now = new Date();
    const payment = new Payment({
      id: randomUUID(),
      externalPaymentId: null,
      externalReference: input.externalReference,
      amount: input.amount,
      description: input.description,
      status: PaymentStatus.PENDING,
      expirationDate: input.expirationDate,
      checkoutUrl: null,
      shortUrl: null,
      barCode: null,
      createdAt: now,
      updatedAt: now,
    });

    // Persist before calling the provider so an idempotency record exists even
    // on gateway failure. A PENDING payment left in the DB is intentional:
    // it prevents double-charging the payer on retries and can be reconciled
    // by a background job. The error is propagated to the controller as-is.
    await this.paymentRepository.save(payment);

    // ── Call provider ─────────────────────────────────────────────────────────
    const result = await this.providerGateway.createPayment({
      amount: input.amount,
      expirationDate: input.expirationDate,
      description: input.description,
      externalReference: input.externalReference,
      redirectUrl: input.redirectUrl,
      webhookUrl: input.webhookUrl,
      surcharge: input.surcharge,
      secondExpirationDate: input.secondExpirationDate,
      secondaryReference: input.secondaryReference,
    });

    // ── Confirm creation and persist updated state ────────────────────────────
    payment.markAsCreated(
      result.providerPaymentId,
      result.checkoutUrl,
      result.shortUrl,
      result.barcode,
    );
    await this.paymentRepository.update(payment);

    return {
      id: payment.id,
      externalPaymentId: result.providerPaymentId,
      externalReference: payment.externalReference,
      status: payment.status,
      checkoutUrl: payment.checkoutUrl,
      shortUrl: payment.shortUrl,
      barCode: payment.barCode,
      amount: payment.amount,
      expirationDate: result.expirationDate,
      createdAt: payment.createdAt,
    };
  }

  private toOutput(payment: Payment): CreatePaymentOutput {
    return {
      id: payment.id,
      externalPaymentId: payment.externalPaymentId!,
      externalReference: payment.externalReference,
      status: payment.status,
      checkoutUrl: payment.checkoutUrl,
      shortUrl: payment.shortUrl,
      barCode: payment.barCode,
      amount: payment.amount,
      expirationDate: payment.expirationDate,
      createdAt: payment.createdAt,
    };
  }
}
