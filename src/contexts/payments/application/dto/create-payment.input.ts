export interface CreatePaymentInput {
  /** Payment amount in cents. */
  amount: number;
  /** ISO 8601 date (YYYY-MM-DD). */
  expirationDate: string;
  description: string;
  /** Merchant-assigned idempotency key. */
  externalReference: string;
  redirectUrl: string;
  webhookUrl?: string;
  /** Optional surcharge in cents. */
  surcharge?: number;
  /** Second expiration date for two-tier pricing. */
  secondExpirationDate?: string;
  secondaryReference?: string;
}
