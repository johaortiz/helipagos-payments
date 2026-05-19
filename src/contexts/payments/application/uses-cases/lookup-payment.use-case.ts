import { Injectable } from '@nestjs/common';

import { Payment } from '../../domain/entities/payment.entity';
import { PaymentNotFoundException } from '../../domain/exceptions/payment-not-found-exception';
import { PaymentRepository } from '../../domain/repositories/payment.repository';

// ─── Input ────────────────────────────────────────────────────────────────────

export interface LookupPaymentInput {
  /** Merchant-assigned reference. Takes precedence over externalPaymentId. */
  externalReference?: string;
  /** Provider-assigned numeric ID (Helipagos id_sp). */
  externalPaymentId?: number;
}

// ─── Output ───────────────────────────────────────────────────────────────────

export interface LookupPaymentOutput {
  id: string;
  externalPaymentId: number | null;
  externalReference: string;
  /** Local domain status — reflects the last webhook-driven transition. */
  status: string;
  amount: number;
  description: string;
  checkoutUrl: string | null;
  shortUrl: string | null;
  barCode: string | null;
  expirationDate: string;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Use case ─────────────────────────────────────────────────────────────────

@Injectable()
export class LookupPaymentUseCase {
  constructor(private readonly paymentRepository: PaymentRepository) {}

  async execute(input: LookupPaymentInput): Promise<LookupPaymentOutput> {
    let payment: Payment | null = null;

    // externalReference takes precedence when both params are provided.
    if (input.externalReference !== undefined) {
      payment = await this.paymentRepository.findByExternalReference(
        input.externalReference,
      );
    } else if (input.externalPaymentId !== undefined) {
      payment = await this.paymentRepository.findByExternalPaymentId(
        input.externalPaymentId,
      );
    }

    if (!payment) {
      const identifier =
        input.externalReference ?? String(input.externalPaymentId);
      throw new PaymentNotFoundException(identifier);
    }

    return {
      id: payment.id,
      externalPaymentId: payment.externalPaymentId,
      externalReference: payment.externalReference,
      status: payment.status,
      amount: payment.amount,
      description: payment.description,
      checkoutUrl: payment.checkoutUrl,
      shortUrl: payment.shortUrl,
      barCode: payment.barCode,
      expirationDate: payment.expirationDate,
      createdAt: payment.createdAt,
      updatedAt: payment.updatedAt,
    };
  }
}
