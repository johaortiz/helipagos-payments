/**
 * Business-level payment states.
 * Provider-backed values stay aligned with Helipagos when available.
 */
export enum PaymentStatus {
  PENDING = 'PENDING',
  CREATED = 'GENERADA',
  PROCESSED = 'PROCESADA',
  ACCREDITED = 'ACREDITADA',
  REFUNDED = 'DEVUELTA',
  EXPIRED = 'VENCIDA',
  CANCELLED = 'ANULADA',
  REJECTED = 'RECHAZADA',
  CHARGEBACK = 'CONTRACARGO',
}
