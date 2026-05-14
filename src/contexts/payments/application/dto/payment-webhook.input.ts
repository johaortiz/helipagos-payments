/**
 * Raw webhook payload received from the Helipagos payment provider.
 * Field names intentionally use the provider's snake_case convention —
 * mapping to domain camelCase happens in the use case layer.
 */
export interface PaymentWebhookInput {
  id_sp: number;
  /** Raw provider status string. Mapped to PaymentStatus enum in the use case. */
  estado: string;
  referencia_externa: string;
  medio_pago?: string;
  /** Provider sends the paid amount as a string, not a number. */
  importe_abonado?: string;
  fecha_importe?: string;
}
