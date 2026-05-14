import { Injectable } from '@nestjs/common';

import { PaymentProviderGateway } from '../../domain/gateways/payment-provider.gateway';
import { PaymentRepository } from '../../domain/repositories/payment.repository';

@Injectable()
export class CancelPaymentUseCase {
  constructor(
    private readonly paymentRepository: PaymentRepository,
    private readonly providerGateway: PaymentProviderGateway,
  ) {}

  async execute(id: string): Promise<void> {
    const payment = await this.paymentRepository.findById(id);

    if (!payment) {
      throw new Error(`Payment not found: ${id}`);
    }

    // Enforces domain rules: throws InvalidPaymentTransitionException or
    // PaymentAlreadyFinalizedException if the transition is not allowed.
    // These propagate to the infrastructure layer for HTTP mapping.
    payment.cancel();

    // A PENDING payment has no provider record — skip the gateway call.
    if (payment.externalPaymentId !== null) {
      await this.providerGateway.cancelPayment(payment.externalPaymentId);
    }

    await this.paymentRepository.update(payment);
  }
}
