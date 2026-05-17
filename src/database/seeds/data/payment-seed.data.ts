import { PaymentOrmEntity } from '../../../contexts/payments/infrastructure/persistence/entities/payment.orm-entity';
import { PaymentStatus } from '../../../contexts/payments/domain/enums/payment-status.enum';

/**
 * Fixed UUIDs ensure the seed is fully reproducible across environments.
 * Pattern: 00000001-seed-4e00-a000-<sequential suffix>
 * These are valid v4 UUIDs (version nibble = 4, variant nibble = a).
 */

export type PaymentSeedRecord = Omit<
  PaymentOrmEntity,
  'createdAt' | 'updatedAt'
>;

export const PAYMENT_SEED_DATA: PaymentSeedRecord[] = [
  // ─── PENDING ────────────────────────────────────────────────────────────────
  // Payments created locally but not yet submitted to Helipagos.
  {
    id: '00000001-0000-4000-a000-000000000001',
    externalPaymentId: null,
    externalReference: 'seed-order-pending-001',
    amount: 150000,
    description: 'Monthly subscription — Starter Plan',
    status: PaymentStatus.PENDING,
    expirationDate: '2026-12-31',
    checkoutUrl: null,
    shortUrl: null,
    barCode: null,
  },
  {
    id: '00000001-0000-4000-a000-000000000002',
    externalPaymentId: null,
    externalReference: 'seed-order-pending-002',
    amount: 500000,
    description: 'Annual license renewal — Enterprise',
    status: PaymentStatus.PENDING,
    expirationDate: '2026-11-30',
    checkoutUrl: null,
    shortUrl: null,
    barCode: null,
  },
  {
    id: '00000001-0000-4000-a000-000000000003',
    externalPaymentId: null,
    externalReference: 'seed-order-pending-003',
    amount: 75000,
    description: 'One-time setup fee — Basic integration',
    status: PaymentStatus.PENDING,
    expirationDate: '2026-10-15',
    checkoutUrl: null,
    shortUrl: null,
    barCode: null,
  },

  // ─── PROCESSED (PROCESADA) ──────────────────────────────────────────────────
  // Provider confirmed payment, awaiting settlement.
  {
    id: '00000001-0000-4000-a000-000000000004',
    externalPaymentId: 100101,
    externalReference: 'seed-order-processed-001',
    amount: 250000,
    description: 'Invoice #INV-2026-0412 — Cloud services Q2',
    status: PaymentStatus.PROCESSED,
    expirationDate: '2026-09-30',
    checkoutUrl: 'https://sandbox.helipagos.com/pay/100101',
    shortUrl: 'https://hpg.ar/Xq3mNp',
    barCode: '28950000000250000000100101',
  },
  {
    id: '00000001-0000-4000-a000-000000000005',
    externalPaymentId: 100102,
    externalReference: 'seed-order-processed-002',
    amount: 1200000,
    description: 'Invoice #INV-2026-0389 — Annual SaaS license',
    status: PaymentStatus.PROCESSED,
    expirationDate: '2026-08-31',
    checkoutUrl: 'https://sandbox.helipagos.com/pay/100102',
    shortUrl: 'https://hpg.ar/Kz7wRe',
    barCode: '28950000001200000000100102',
  },
  {
    id: '00000001-0000-4000-a000-000000000006',
    externalPaymentId: 100103,
    externalReference: 'seed-order-processed-003',
    amount: 350000,
    description: 'Training package — 5 sessions',
    status: PaymentStatus.PROCESSED,
    expirationDate: '2026-09-15',
    checkoutUrl: 'https://sandbox.helipagos.com/pay/100103',
    shortUrl: 'https://hpg.ar/Lm2vCy',
    barCode: '28950000000350000000100103',
  },

  // ─── CANCELLED (ANULADA) ────────────────────────────────────────────────────
  // Voided by merchant or provider before settlement.
  {
    id: '00000001-0000-4000-a000-000000000007',
    externalPaymentId: 100201,
    externalReference: 'seed-order-cancelled-001',
    amount: 90000,
    description: 'Workshop registration — May cohort (cancelled)',
    status: PaymentStatus.CANCELLED,
    expirationDate: '2026-05-31',
    checkoutUrl: 'https://sandbox.helipagos.com/pay/100201',
    shortUrl: 'https://hpg.ar/Pn9dFb',
    barCode: '28950000000090000000100201',
  },
  {
    id: '00000001-0000-4000-a000-000000000008',
    externalPaymentId: 100202,
    externalReference: 'seed-order-cancelled-002',
    amount: 2500000,
    description: 'Enterprise contract deposit — Project Alpha (cancelled)',
    status: PaymentStatus.CANCELLED,
    expirationDate: '2026-06-30',
    checkoutUrl: 'https://sandbox.helipagos.com/pay/100202',
    shortUrl: 'https://hpg.ar/Wr4tHk',
    barCode: '28950000002500000000100202',
  },

  // ─── EXPIRED (VENCIDA) ──────────────────────────────────────────────────────
  // Payment link expired before the customer completed the transaction.
  {
    id: '00000001-0000-4000-a000-000000000009',
    externalPaymentId: 100301,
    externalReference: 'seed-order-expired-001',
    amount: 180000,
    description: 'Invoice #INV-2026-0310 — Consulting hours (expired)',
    status: PaymentStatus.EXPIRED,
    expirationDate: '2026-04-30',
    checkoutUrl: 'https://sandbox.helipagos.com/pay/100301',
    shortUrl: 'https://hpg.ar/Gb8sQj',
    barCode: '28950000000180000000100301',
  },
  {
    id: '00000001-0000-4000-a000-00000000000a',
    externalPaymentId: 100302,
    externalReference: 'seed-order-expired-002',
    amount: 45000,
    description: 'Domain renewal — helipagos-demo.ar (expired)',
    status: PaymentStatus.EXPIRED,
    expirationDate: '2026-03-31',
    checkoutUrl: 'https://sandbox.helipagos.com/pay/100302',
    shortUrl: 'https://hpg.ar/Tc5uAi',
    barCode: '28950000000045000000100302',
  },
];
