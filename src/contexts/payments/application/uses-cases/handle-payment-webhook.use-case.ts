import { Injectable } from '@nestjs/common';

import { Payment } from '../../domain/entities/payment.entity';
import { PaymentRepository } from '../../domain/repositories/payment.repository';
import { PaymentWebhookInput } from '../dto/payment-webhook.input';

@Injectable()
export class HandlePaymentWebhookUseCase {
  constructor(private readonly paymentRepository: PaymentRepository) {}

  // This method never throws. The webhook contract with the provider requires
  // HTTP 200 on every response — throwing would propagate to the controller
  // and trigger indefinite retries from the provider, amplifying the problem.
  async execute(input: PaymentWebhookInput): Promise<void> {
    // findByExternalPaymentId is used here because the webhook carries id_sp
    // (the provider's numeric ID), not the internal domain UUID.
    // The repository contract exposes findByIdForUpdate for pessimistic locking
    // (SELECT FOR UPDATE), but it operates on internal IDs. The infrastructure
    // implementation should wrap this lookup in a transaction to prevent
    // concurrent webhooks from corrupting the same payment's state.
    const payment = await this.paymentRepository.findByExternalPaymentId(
      input.id_sp,
    );

    if (!payment) {
      // The provider may send webhooks for payments unknown to this system
      // (created externally, before integration, or with mismatched IDs).
      // Returning silently keeps the endpoint responsive and prevents
      // the provider from retrying indefinitely for unresolvable events.
      console.warn(
        `[HandlePaymentWebhook] No payment found for provider ID: ${input.id_sp}`,
      );
      return;
    }

    try {
      this.applyTransition(payment, input.estado);
      await this.paymentRepository.update(payment);
    } catch (error) {
      // Domain exceptions (InvalidPaymentTransitionException,
      // PaymentAlreadyFinalizedException) are caught here — unlike other use
      // cases — because rethrowing would break the HTTP 200 contract and cause
      // the provider to retry. Logging preserves observability without
      // disrupting the webhook handshake.
      console.error(
        `[HandlePaymentWebhook] Transition failed for payment ${payment.id}`,
        error,
      );
    }
  }

  private applyTransition(payment: Payment, estado: string): void {
    switch (estado) {
      case 'PROCESADA':
        payment.markAsProcessed();
        break;

      case 'ACREDITADA':
        payment.markAsAccredited();
        break;

      case 'VENCIDA':
        payment.expire();
        break;

      case 'ANULADA':
      case 'RECHAZADA':
        payment.reject();
        break;

      case 'DEVUELTA':
      case 'CONTRACARGO':
        payment.chargeback();
        break;

      default:
        // Unknown estados are silently ignored. The provider may introduce new
        // status values in future API versions — ignoring them keeps the system
        // forward-compatible without requiring a deployment for every provider change.
        console.warn(
          `[HandlePaymentWebhook] Unknown estado '${estado}' for payment ${payment.id}. Skipping.`,
        );
    }
  }
}
