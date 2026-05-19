export class PaymentDomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PaymentDomainError';
  }
}
