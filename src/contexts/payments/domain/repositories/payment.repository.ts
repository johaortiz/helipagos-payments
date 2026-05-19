import { Payment } from '../entities/payment.entity';

export abstract class PaymentRepository {
  /**
   * Persists a new payment.
   * Implementations must guarantee uniqueness on externalReference.
   */
  abstract save(payment: Payment): Promise<void>;

  /**
   * Persists state changes on an existing payment.
   * Called after every domain transition (status change, etc.).
   */
  abstract update(payment: Payment): Promise<void>;

  /** Returns the payment matching the internal domain ID, or null. */
  abstract findById(id: string): Promise<Payment | null>;

  /**
   * Acquires a pessimistic write lock on the payment record and returns it.
   * Use this before processing webhooks to prevent concurrent state corruption.
   * Returns null if the payment does not exist.
   */
  abstract findByIdForUpdate(id: string): Promise<Payment | null>;

  /**
   * Looks up a payment by the merchant-supplied external reference.
   * Used for idempotency checks before creating a new payment.
   */
  abstract findByExternalReference(
    externalReference: string,
  ): Promise<Payment | null>;

  /**
   * Looks up a payment by the provider-assigned ID (Helipagos id_sp).
   * Used to correlate incoming webhooks with domain payments.
   */
  abstract findByExternalPaymentId(
    externalPaymentId: number,
  ): Promise<Payment | null>;

  /**
   * Returns true if a payment with the given external reference already exists.
   * Prefer this over findByExternalReference when you only need an existence check.
   */
  abstract existsByExternalReference(
    externalReference: string,
  ): Promise<boolean>;

  /**
   * Acquires a pessimistic write lock on the payment record by provider ID.
   * Use this in webhook handlers to prevent concurrent state corruption
   * when multiple webhooks arrive for the same payment simultaneously.
   * Returns null if no payment exists for the given provider ID.
   */
  abstract findByExternalPaymentIdForUpdate(
    externalPaymentId: number,
  ): Promise<Payment | null>;

  /**
   * Executes the full read → lock → transition → write cycle inside a single
   * database transaction.
   *
   * Acquires a pessimistic write lock by provider ID, maps the record to a
   * domain Payment, invokes the handler, and persists the result only if the
   * handler returns true. Returns null (without invoking the handler) when no
   * payment exists for the given provider ID.
   *
   * If the handler throws, the transaction is rolled back automatically and
   * the error is re-thrown to the caller.
   */
  abstract processByExternalPaymentIdForUpdate(
    externalPaymentId: number,
    handler: (payment: Payment) => boolean | Promise<boolean>,
  ): Promise<Payment | null>;
}
