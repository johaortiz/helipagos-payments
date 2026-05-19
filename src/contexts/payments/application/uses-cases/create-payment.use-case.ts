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
    // ── Idempotency / recovery check ──────────────────────────────────────────
    const existing = await this.paymentRepository.findByExternalReference(
      input.externalReference,
    );

    if (existing) {
      // Provider creation was fully completed — return idempotently.
      if (existing.externalPaymentId !== null) {
        return this.toOutput(existing);
      }

      // PENDING with no externalPaymentId: the previous attempt created the
      // local record but the provider call failed. Retry the provider using
      // the same local payment so no duplicate record is created.
      return this.callProviderAndUpdate(existing, input);
    }

    // ── New payment: persist PENDING before calling the provider ──────────────
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
    // subsequent POST requests with the same externalReference will retry the
    // provider against this record instead of creating a duplicate.
    await this.paymentRepository.save(payment);

    return this.callProviderAndUpdate(payment, input);
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  /**
   * Calls the provider, marks the payment as created, persists the update,
   * and returns the output DTO.  Throws the provider error as-is on failure
   * so the caller (new-payment path or retry path) propagates it cleanly.
   */
  private async callProviderAndUpdate(
    payment: Payment,
    input: CreatePaymentInput,
  ): Promise<CreatePaymentOutput> {
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
