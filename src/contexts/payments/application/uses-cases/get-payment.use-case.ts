import { Injectable } from '@nestjs/common';

import { PaymentProviderGateway } from '../../domain/gateways/payment-provider.gateway';
import { PaymentRepository } from '../../domain/repositories/payment.repository';
import { PaymentNotFoundException } from '../../domain/exceptions/payment-not-found-exception';

// ─── Output ───────────────────────────────────────────────────────────────────

export interface GetPaymentOutput {
  id: string;
  externalPaymentId: number | null;
  externalReference: string;
  /** Live provider status when available; local domain status otherwise. */
  status: string;
  amount: number;
  description: string;
  checkoutUrl: string | null;
  expirationDate: string;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Use case ─────────────────────────────────────────────────────────────────

@Injectable()
export class GetPaymentUseCase {
  constructor(
    private readonly paymentRepository: PaymentRepository,
    private readonly providerGateway: PaymentProviderGateway,
  ) {}

  async execute(id: string): Promise<GetPaymentOutput> {
    const payment = await this.paymentRepository.findById(id);

    if (!payment) {
      throw new PaymentNotFoundException(id);
    }

    // If the payment has no provider ID it is still in PENDING state —
    // no provider record exists to query yet, so return local data only.
    if (payment.externalPaymentId === null) {
      return {
        id: payment.id,
        externalPaymentId: null,
        externalReference: payment.externalReference,
        status: payment.status,
        amount: payment.amount,
        description: payment.description,
        checkoutUrl: payment.checkoutUrl,
        expirationDate: payment.expirationDate.toISOString().split('T')[0],
        createdAt: payment.createdAt,
        updatedAt: payment.updatedAt,
      };
    }

    const details = await this.providerGateway.getPayment(
      payment.externalPaymentId,
    );

    // The local status is intentionally NOT updated here.
    // Status transitions are driven exclusively by webhook events to guarantee
    // a single, ordered source of truth. Updating on GET would risk applying
    // out-of-order state changes if the provider returns a stale or cached value.
    return {
      id: payment.id,
      externalPaymentId: payment.externalPaymentId,
      externalReference: payment.externalReference,
      status: details.status,
      amount: payment.amount,
      description: payment.description,
      checkoutUrl: details.checkoutUrl,
      expirationDate: details.expirationDate,
      createdAt: payment.createdAt,
      updatedAt: payment.updatedAt,
    };
  }
}
