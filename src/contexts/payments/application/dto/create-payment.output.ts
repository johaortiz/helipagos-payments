export interface CreatePaymentOutput {
  /** Internal domain ID. */
  id: string;
  /** Provider-assigned payment ID (Helipagos id_sp). */
  externalPaymentId: number;
  externalReference: string;
  status: string;
  checkoutUrl: string | null;
  shortUrl: string | null;
  barCode: string | null;
  /** Amount in cents. */
  amount: number;
  /** ISO 8601 date (YYYY-MM-DD). */
  expirationDate: string;
  createdAt: Date;
}
