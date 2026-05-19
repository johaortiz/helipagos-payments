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

// ─── Typed response shapes ────────────────────────────────────────────────────

interface LoginResponseBody {
  accessToken: string;
}

interface PaymentBody {
  id: string;
  externalPaymentId: number | null;
  externalReference: string;
  status: string;
  amount: number;
}

// ─── Shared test data ─────────────────────────────────────────────────────────

const PROVIDER_PAYMENT_ID = 706153;
const EXTERNAL_REFERENCE = 'lookup-e2e-ref-001';

function buildGatewayResult(providerPaymentId: number): CreatePaymentResult {
  return {
    providerPaymentId,
    status: 'GENERADA',
    checkoutUrl: `https://checkout.helipagos.com/pay/${providerPaymentId}`,
    shortUrl: 'https://hpg.ar/lookup-test',
    barcode: '1234567890',
    expirationDate: '2026-12-31',
    amount: 150000,
    createdAt: '2026-05-17T00:00:00.000Z',
  };
}

function buildPaymentBody(externalReference: string) {
  return {
    amount: 150000,
    expirationDate: '2026-12-31',
    description: 'Lookup E2E test',
    externalReference,
    redirectUrl: 'https://example.com/payment/result',
  };
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('GET /api/payments/lookup', () => {
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

    // Seed one CREATED payment to use across all success-path scenarios.
    gateway.createPayment.mockResolvedValueOnce(
      buildGatewayResult(PROVIDER_PAYMENT_ID),
    );
    await request(server)
      .post('/api/payments')
      .set('Authorization', `Bearer ${authToken}`)
      .send(buildPaymentBody(EXTERNAL_REFERENCE));
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    gateway.createPayment.mockReset();
  });

  // ── 1 ─────────────────────────────────────────────────────────────────────

  it('should return 200 and the payment when found by externalReference', async () => {
    const res = await request(server)
      .get('/api/payments/lookup')
      .query({ externalReference: EXTERNAL_REFERENCE })
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);

    const body = res.body as PaymentBody;
    expect(body.externalReference).toBe(EXTERNAL_REFERENCE);
    expect(body.externalPaymentId).toBe(PROVIDER_PAYMENT_ID);
    expect(body.status).toBe('GENERADA');
    expect(body.amount).toBe(150000);
    expect(typeof body.id).toBe('string');
  });

  // ── 2 ─────────────────────────────────────────────────────────────────────

  it('should return 200 and the payment when found by externalPaymentId', async () => {
    const res = await request(server)
      .get('/api/payments/lookup')
      .query({ externalPaymentId: PROVIDER_PAYMENT_ID })
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);

    const body = res.body as PaymentBody;
    expect(body.externalPaymentId).toBe(PROVIDER_PAYMENT_ID);
    expect(body.externalReference).toBe(EXTERNAL_REFERENCE);
  });

  // ── 3 ─────────────────────────────────────────────────────────────────────

  it('should prefer externalReference over externalPaymentId when both are supplied', async () => {
    const res = await request(server)
      .get('/api/payments/lookup')
      .query({
        externalReference: EXTERNAL_REFERENCE,
        externalPaymentId: PROVIDER_PAYMENT_ID,
      })
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);

    const body = res.body as PaymentBody;
    expect(body.externalReference).toBe(EXTERNAL_REFERENCE);
  });

  // ── 4 ─────────────────────────────────────────────────────────────────────

  it('should return 400 when no query params are supplied', async () => {
    const res = await request(server)
      .get('/api/payments/lookup')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(400);
  });

  // ── 5 ─────────────────────────────────────────────────────────────────────

  it('should return 404 when no payment matches the given externalReference', async () => {
    const res = await request(server)
      .get('/api/payments/lookup')
      .query({ externalReference: 'does-not-exist-ref' })
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(404);
  });

  // ── 6 ─────────────────────────────────────────────────────────────────────

  it('should return 404 when no payment matches the given externalPaymentId', async () => {
    const res = await request(server)
      .get('/api/payments/lookup')
      .query({ externalPaymentId: 99999 })
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(404);
  });

  // ── 7 ─────────────────────────────────────────────────────────────────────

  it('should return 401 when no JWT token is provided', async () => {
    const res = await request(server)
      .get('/api/payments/lookup')
      .query({ externalReference: EXTERNAL_REFERENCE });

    expect(res.status).toBe(401);
  });
});
