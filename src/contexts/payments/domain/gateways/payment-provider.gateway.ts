// ─── Request contracts ───────────────────────────────────────────────────────

export interface CreatePaymentRequest {
  amount: number;
  /** ISO 8601 date string (e.g. "2026-12-31"). */
  expirationDate: string;
  description: string;
  /** Merchant-assigned idempotency key. Must be unique per payment. */
  externalReference: string;
  /** URL the provider redirects the payer to after checkout. */
  redirectUrl: string;
  webhookUrl?: string;
  surcharge?: number;
  secondExpirationDate?: string;
  secondaryReference?: string;
}

// ─── Result contracts ─────────────────────────────────────────────────────────

export interface CreatePaymentResult {
  /** Provider-assigned payment ID. Maps to Helipagos id_sp. */
  providerPaymentId: number;
  /** Raw status string returned by the provider. */
  status: string;
  checkoutUrl: string;
  shortUrl: string;
  barcode: string;
  expirationDate: string;
  amount: number;
  /** ISO 8601 datetime. */
  createdAt: string;
}

export interface PaymentDetails {
  providerPaymentId: number;
  externalReference: string;
  /** Raw status string returned by the provider. */
  status: string;
  amount: number;
  paidAmount: number | null;
  paymentMethod: string | null;
  checkoutUrl: string;
  expirationDate: string;
  paymentDate: string | null;
  creditedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CancelPaymentResult {
  success: boolean;
  message: string;
}

// ─── Gateway ─────────────────────────────────────────────────────────────────

export abstract class PaymentProviderGateway {
  /**
   * Registers a new payment with the provider.
   * Returns provider-assigned identifiers and checkout data.
   */
  abstract createPayment(
    request: CreatePaymentRequest,
  ): Promise<CreatePaymentResult>;

  /**
   * Fetches current payment state from the provider.
   * Used to sync domain status after a webhook or manual check.
   */
  abstract getPayment(providerPaymentId: number): Promise<PaymentDetails>;

  /**
   * Requests cancellation of a payment at the provider.
   * The caller is responsible for validating domain rules before invoking this.
   */
  abstract cancelPayment(providerPaymentId: number): Promise<CancelPaymentResult>;
}
