import { Injectable, Logger } from '@nestjs/common';

import { PaymentAlreadyFinalizedException } from '../../domain/exceptions/payment-already-finalized.exception';
import { InvalidPaymentTransitionException } from '../../domain/exceptions/invalid-payment-transition.exception';
import { PaymentDomainError } from '../../domain/exceptions/payment-domain.error';
import { Payment } from '../../domain/entities/payment.entity';
import { PaymentRepository } from '../../domain/repositories/payment.repository';
import { PaymentWebhookInput } from '../dto/payment-webhook.input';

@Injectable()
export class HandlePaymentWebhookUseCase {
  private readonly logger = new Logger(HandlePaymentWebhookUseCase.name);

  constructor(private readonly paymentRepository: PaymentRepository) {}

  // This method never throws. The webhook contract with the provider requires
  // HTTP 200 on every response — throwing would propagate to the controller
  // and trigger indefinite retries from the provider, amplifying the problem.
  async execute(input: PaymentWebhookInput): Promise<void> {
    try {
      // processByExternalPaymentIdForUpdate runs the entire read → lock →
      // handler → conditional-write cycle inside a single transaction. The
      // pessimistic write lock is held for the full duration, preventing a
      // second concurrent webhook for the same payment from reading stale state.
      const result =
        await this.paymentRepository.processByExternalPaymentIdForUpdate(
          input.id_sp,
          (payment) => this.applyTransition(payment, input.estado),
        );

      if (result === null) {
        // The provider may send webhooks for payments unknown to this system
        // (created externally, before integration, or with mismatched IDs).
        this.logger.warn(
          `[HandlePaymentWebhook] No payment found for provider ID: ${input.id_sp}`,
        );
      }
    } catch (error) {
      // Domain exceptions are caught here — unlike other use cases — because
      // rethrowing would break the HTTP 200 contract and cause the provider to
      // retry. Logging preserves observability without disrupting the handshake.
      //
      // Controlled domain rule violations are expected during normal operation
      // (e.g. provider sends duplicate webhooks, out-of-order events) and are
      // logged at WARN. Truly unexpected errors are logged at ERROR.
      const isControlledDomainError =
        error instanceof PaymentDomainError ||
        error instanceof InvalidPaymentTransitionException ||
        error instanceof PaymentAlreadyFinalizedException;

      if (isControlledDomainError) {
        this.logger.warn(
          `[HandlePaymentWebhook] Transition failed for provider ID ${input.id_sp}: ${error instanceof Error ? error.message : String(error)}`,
        );
      } else {
        this.logger.error(
          `[HandlePaymentWebhook] Unexpected error for provider ID ${input.id_sp}`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }
  }

  private applyTransition(payment: Payment, estado: string): boolean {
    switch (estado) {
      case 'PROCESADA':
        payment.markAsProcessed();
        return true;

      case 'ACREDITADA':
        payment.markAsAccredited();
        return true;

      case 'VENCIDA':
        payment.expire();
        return true;

      case 'ANULADA':
      case 'RECHAZADA':
        payment.reject();
        return true;

      case 'DEVUELTA':
      case 'CONTRACARGO':
        payment.chargeback();
        return true;

      default:
        // Unknown estados are silently ignored. The provider may introduce new
        // status values in future API versions — ignoring them keeps the system
        // forward-compatible without requiring a deployment for every provider change.
        this.logger.warn(
          `[HandlePaymentWebhook] Unknown estado '${estado}' for payment ${payment.id}. Skipping.`,
        );
        return false;
    }
  }
}
