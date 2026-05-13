import { PaymentStatus } from '../enums/payment-status.enum';

export class InvalidPaymentTransitionException extends Error {
  constructor(
    public readonly currentStatus: PaymentStatus,
    public readonly attemptedTransition: string,
  ) {
    super(
      `Invalid transition '${attemptedTransition}' from status '${currentStatus}'`,
    );
    this.name = 'InvalidPaymentTransitionException';
  }
}
