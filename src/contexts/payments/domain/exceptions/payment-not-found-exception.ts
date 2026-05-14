export class PaymentNotFoundException extends Error {
  constructor(public readonly paymentId: string) {
    super(`Payment with id '${paymentId}' not found`);
    this.name = 'PaymentNotFoundException';
  }
}
