import { randomUUID } from 'crypto';

import {
  Payment,
  PaymentProps,
} from '../../../src/contexts/payments/domain/entities/payment.entity';
import { PaymentStatus } from '../../../src/contexts/payments/domain/enums/payment-status.enum';

const BASE_PROPS: Omit<
  PaymentProps,
  'status' | 'externalPaymentId' | 'checkoutUrl' | 'shortUrl' | 'barCode'
> = {
  id: randomUUID(),
  externalReference: 'order-test-001',
  amount: 150000,
  description: 'Monthly subscription payment',
  expirationDate: '2026-12-31',
  createdAt: new Date('2026-05-15T10:00:00.000Z'),
  updatedAt: new Date('2026-05-15T10:00:00.000Z'),
};

export function createPendingPaymentFixture(
  overrides?: Partial<PaymentProps>,
): Payment {
  return new Payment({
    ...BASE_PROPS,
    id: randomUUID(),
    externalPaymentId: null,
    checkoutUrl: null,
    shortUrl: null,
    barCode: null,
    status: PaymentStatus.PENDING,
    ...overrides,
  });
}

export function createCreatedPaymentFixture(
  overrides?: Partial<PaymentProps>,
): Payment {
  return new Payment({
    ...BASE_PROPS,
    id: randomUUID(),
    externalPaymentId: 987654,
    checkoutUrl: 'https://checkout.helipagos.com/pay/987654',
    shortUrl: 'https://hpg.ar/abc123',
    barCode: '1234567890123456',
    status: PaymentStatus.CREATED,
    ...overrides,
  });
}

export function createProcessedPaymentFixture(
  overrides?: Partial<PaymentProps>,
): Payment {
  return new Payment({
    ...BASE_PROPS,
    id: randomUUID(),
    externalPaymentId: 987654,
    checkoutUrl: 'https://checkout.helipagos.com/pay/987654',
    shortUrl: 'https://hpg.ar/abc123',
    barCode: '1234567890123456',
    status: PaymentStatus.PROCESSED,
    updatedAt: new Date('2026-05-15T12:30:00.000Z'),
    ...overrides,
  });
}
