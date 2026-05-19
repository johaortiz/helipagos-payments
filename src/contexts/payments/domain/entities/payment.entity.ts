import { PaymentDomainError } from '../exceptions/payment-domain.error';
import { PaymentStatus } from '../enums/payment-status.enum';

// ─── Construction props ──────────────────────────────────────────────────────

export interface PaymentProps {
  id: string;
  /** Provider ID (Helipagos id_sp). Null until the provider confirms creation. */
  externalPaymentId: number | null;
  externalReference: string;
  amount: number;
  description: string;
  status: PaymentStatus;
  expirationDate: string;
  checkoutUrl: string | null;
  shortUrl: string | null;
  barCode: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Entity ──────────────────────────────────────────────────────────────────

export class Payment {
  readonly id: string;

  private _externalPaymentId: number | null;
  private _externalReference: string;
  private _amount: number;
  private _description: string;
  private _status: PaymentStatus;
  private _expirationDate: string;
  private _checkoutUrl: string | null;
  private _shortUrl: string | null;
  private _barCode: string | null;
  private _createdAt: Date;
  private _updatedAt: Date;

  constructor(props: PaymentProps) {
    this.id = props.id;
    this._externalPaymentId = props.externalPaymentId;
    this._externalReference = props.externalReference;
    this._amount = props.amount;
    this._description = props.description;
    this._status = props.status;
    this._expirationDate = props.expirationDate;
    this._checkoutUrl = props.checkoutUrl;
    this._shortUrl = props.shortUrl;
    this._barCode = props.barCode;
    this._createdAt = props.createdAt;
    this._updatedAt = props.updatedAt;
  }

  // ─── Getters ───────────────────────────────────────────────────────────────

  get externalPaymentId(): number | null {
    return this._externalPaymentId;
  }
  get externalReference(): string {
    return this._externalReference;
  }
  get amount(): number {
    return this._amount;
  }
  get description(): string {
    return this._description;
  }
  get status(): PaymentStatus {
    return this._status;
  }
  get expirationDate(): string {
    return this._expirationDate;
  }
  get checkoutUrl(): string | null {
    return this._checkoutUrl;
  }
  get shortUrl(): string | null {
    return this._shortUrl;
  }
  get barCode(): string | null {
    return this._barCode;
  }
  get createdAt(): Date {
    return this._createdAt;
  }
  get updatedAt(): Date {
    return this._updatedAt;
  }

  // ─── Transitions ───────────────────────────────────────────────────────────

  /**
   * Confirms the provider accepted the payment and assigned an external ID.
   * Only valid from PENDING.
   */
  markAsCreated(
    externalPaymentId: number,
    checkoutUrl: string | null,
    shortUrl: string | null,
    barCode: string | null,
  ): void {
    if (this._status === PaymentStatus.CREATED) return;
    if (this._status !== PaymentStatus.PENDING) {
      throw new PaymentDomainError(
        `markAsCreated requires PENDING status, current: ${this._status}`,
      );
    }
    this._externalPaymentId = externalPaymentId;
    this._checkoutUrl = checkoutUrl;
    this._shortUrl = shortUrl;
    this._barCode = barCode;
    this._status = PaymentStatus.CREATED;
    this.touch();
  }

  /**
   * Records that the payer initiated the payment at the provider.
   * Expired payments cannot be processed.
   */
  markAsProcessed(): void {
    if (this._status === PaymentStatus.PROCESSED) return;
    this.assertNotTerminal();
    if (this._status !== PaymentStatus.CREATED) {
      throw new PaymentDomainError(
        `markAsProcessed requires CREATED status, current: ${this._status}`,
      );
    }
    this._status = PaymentStatus.PROCESSED;
    this.touch();
  }

  /**
   * Records that funds were credited to the merchant.
   * Only valid after processing.
   */
  markAsAccredited(): void {
    if (this._status === PaymentStatus.ACCREDITED) return;
    this.assertNotTerminal();
    if (this._status !== PaymentStatus.PROCESSED) {
      throw new PaymentDomainError(
        `markAsAccredited requires PROCESSED status, current: ${this._status}`,
      );
    }
    this._status = PaymentStatus.ACCREDITED;
    this.touch();
  }

  /**
   * Cancels the payment.
   * Processed or accredited payments cannot be cancelled.
   */
  cancel(): void {
    if (this._status === PaymentStatus.CANCELLED) return;
    if (
      this._status === PaymentStatus.PROCESSED ||
      this._status === PaymentStatus.ACCREDITED
    ) {
      throw new PaymentDomainError(
        `Cannot cancel a payment with status: ${this._status}`,
      );
    }
    this.assertNotTerminal();
    this._status = PaymentStatus.CANCELLED;
    this.touch();
  }

  /** Marks the payment as expired after its due date passes. */
  expire(): void {
    if (this._status === PaymentStatus.EXPIRED) return;
    this.assertNotTerminal();
    this._status = PaymentStatus.EXPIRED;
    this.touch();
  }

  /** Records a provider-level rejection (e.g. failed authorization). */
  reject(): void {
    if (this._status === PaymentStatus.REJECTED) return;
    this.assertNotTerminal();
    this._status = PaymentStatus.REJECTED;
    this.touch();
  }

  /**
   * Records a chargeback dispute.
   * Only valid from PROCESSED or ACCREDITED.
   */
  chargeback(): void {
    if (this._status === PaymentStatus.CHARGEBACK) return;
    if (
      this._status !== PaymentStatus.PROCESSED &&
      this._status !== PaymentStatus.ACCREDITED
    ) {
      throw new PaymentDomainError(
        `chargeback requires PROCESSED or ACCREDITED status, current: ${this._status}`,
      );
    }
    this._status = PaymentStatus.CHARGEBACK;
    this.touch();
  }

  // ─── Guards ────────────────────────────────────────────────────────────────

  /**
   * Prevents transitions out of states that are final for most operations.
   * CHARGEBACK has its own guard since it accepts PROCESSED and ACCREDITED as sources.
   */
  private assertNotTerminal(): void {
    const terminalStates: PaymentStatus[] = [
      PaymentStatus.CANCELLED,
      PaymentStatus.EXPIRED,
      PaymentStatus.REJECTED,
      PaymentStatus.CHARGEBACK,
      PaymentStatus.ACCREDITED,
    ];
    if (terminalStates.includes(this._status)) {
      throw new PaymentDomainError(
        `Cannot transition from terminal status: ${this._status}`,
      );
    }
  }

  private touch(): void {
    this._updatedAt = new Date();
  }
}
