import { PaymentStatus } from '../enums/payment-status.enum';

export class PaymentAlreadyFinalizedException extends Error {
  constructor(
    public readonly paymentId: string,
    public readonly finalStatus: PaymentStatus,
  ) {
    super(
      `Payment '${paymentId}' is already finalized with status '${finalStatus}'`,
    );
    this.name = 'PaymentAlreadyFinalizedException';
  }
}
