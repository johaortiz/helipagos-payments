import type { Server } from 'node:http';

import { INestApplication } from '@nestjs/common';
import { TestingModule } from '@nestjs/testing';
import request from 'supertest';

import { CreatePaymentResult } from '../../../src/contexts/payments/domain/gateways/payment-provider.gateway';
import {
  createTestApp,
  getProviderGatewayMock,
} from '../helpers/test-app.factory';

// Module compilation can take several seconds in CI.
jest.setTimeout(30_000);

// ─── Typed response shapes

interface LoginResponseBody {
  accessToken: string;
}

// ─── Shared test data ─────────────────────────────────────────────────────────

function buildGatewayResult(providerPaymentId: number): CreatePaymentResult {
  return {
    providerPaymentId,
    status: 'GENERADA',
    checkoutUrl: `https://checkout.helipagos.com/pay/${providerPaymentId}`,
    shortUrl: 'https://hpg.ar/test',
    barcode: '9876543210',
    expirationDate: '2026-12-31',
    amount: 150000,
    createdAt: '2026-05-17T00:00:00.000Z',
  };
}

function buildPaymentBody(externalReference: string) {
  return {
    amount: 150000,
    expirationDate: '2026-12-31',
    description: 'Webhook E2E test',
    externalReference,
    redirectUrl: 'https://example.com/payment/result',
  };
}

function buildWebhookBody(
  id_sp: number,
  estado: string,
  referencia_externa: string,
  extra?: Record<string, unknown>,
) {
  return { id_sp, estado, referencia_externa, ...extra };
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('POST /api/payments/webhook', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let gateway: ReturnType<typeof getProviderGatewayMock>;
  let authToken: string;
  let server: Server;

  beforeAll(async () => {
    ({ app, moduleRef } = await createTestApp());
    gateway = getProviderGatewayMock(moduleRef);
    server = app.getHttpServer() as Server;

    const loginRes = await request(server)
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'admin123' });

    authToken = (loginRes.body as LoginResponseBody).accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    gateway.createPayment.mockReset();
    // Suppress use-case logging so test output stays clean.
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ─── Helper ────────────────────────────────────────────────────────────────

  /**
   * Creates a CREATED payment via the API and returns the persisted externalPaymentId
   * so webhook tests can reference it with id_sp.
   */
  async function seedPayment(
    externalReference: string,
    providerPaymentId: number,
  ): Promise<number> {
    gateway.createPayment.mockResolvedValueOnce(
      buildGatewayResult(providerPaymentId),
    );
    await request(server)
      .post('/api/payments')
      .set('Authorization', `Bearer ${authToken}`)
      .send(buildPaymentBody(externalReference));
    return providerPaymentId;
  }

  // ── Scenario 1 ──────────────────────────────────────────────────────────────

  it('should return 200 when payload is valid and payment exists in DB', async () => {
    const idSp = await seedPayment('wh-e2e-valid-001', 300001);

    const res = await request(server)
      .post('/api/payments/webhook')
      .send(buildWebhookBody(idSp, 'PROCESADA', 'wh-e2e-valid-001'));

    expect(res.status).toBe(200);
  });

  // ── Scenario 2 ────────────────────────────────────────────────────────────

  it('should return 200 when id_sp is unknown (payment not found)', async () => {
    const res = await request(server)
      .post('/api/payments/webhook')
      .send(buildWebhookBody(999999, 'PROCESADA', 'wh-e2e-unknown-id'));

    expect(res.status).toBe(200);
  });

  // ── Scenario 3 ──────────────────────────────────────────────────────────────

  it('should return 200 when estado is unknown (forward compatible)', async () => {
    // An unknown estado triggers the default: throw in applyTransition, which is
    // caught by the use case try/catch. The endpoint contract (always 200) holds.
    const idSp = await seedPayment('wh-e2e-unknown-estado-003', 300003);

    const res = await request(server)
      .post('/api/payments/webhook')
      .send(
        buildWebhookBody(
          idSp,
          'NUEVO_ESTADO_FUTURO',
          'wh-e2e-unknown-estado-003',
        ),
      );

    expect(res.status).toBe(200);
  });

  // ── Scenario 4 ──────────────────────────────────────────────────────────────

  it('should return 200 even when domain transition throws', async () => {
    // Payment is CREATED (GENERADA). markAsAccredited() requires PROCESSED first.
    // Sending ACREDITADA directly causes PaymentDomainError inside the use case,
    // which is caught and the endpoint still returns 200.
    const idSp = await seedPayment('wh-e2e-domain-throw-004', 300004);

    const res = await request(server)
      .post('/api/payments/webhook')
      .send(buildWebhookBody(idSp, 'ACREDITADA', 'wh-e2e-domain-throw-004'));

    expect(res.status).toBe(200);
  });

  // ── Scenario 5 ──────────────────────────────────────────────────────────────

  it('should return 400 when required fields are missing (id_sp and estado)', async () => {
    const res = await request(server)
      .post('/api/payments/webhook')
      // Only optional fields — all required ones are absent.
      .send({ medio_pago: 'VISA', importe_abonado: '150000' });

    expect(res.status).toBe(400);
  });

  // ── Scenario 6 ──────────────────────────────────────────────────────────────

  it('should not require Authorization header', async () => {
    // No .set('Authorization', ...) — endpoint is @Public() so JwtAuthGuard
    // skips authentication entirely.
    const res = await request(server)
      .post('/api/payments/webhook')
      .send(buildWebhookBody(999888, 'PROCESADA', 'wh-e2e-no-auth'));

    // Payment not found → use case logs and returns. Still 200, not 401.
    expect(res.status).toBe(200);
  });
});
