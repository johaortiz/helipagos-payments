import type { Server } from 'node:http';

import { INestApplication } from '@nestjs/common';
import { TestingModule } from '@nestjs/testing';
import request from 'supertest';

import { CreatePaymentResult } from '../../../src/contexts/payments/domain/gateways/payment-provider.gateway';
import {
  HelipagosAuthenticationError,
  HelipagosUnavailableError,
} from '../../../src/contexts/payments/infrastructure/http/helipagos-http.client';
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

interface PaymentResponseBody {
  id: string;
  externalPaymentId: number;
  externalReference: string;
  amount: number;
  description: string;
  status: string;
  checkoutUrl: string | null;
  createdAt: string;
}

// ─── Shared test data

function buildGatewayResult(providerPaymentId: number): CreatePaymentResult {
  return {
    providerPaymentId,
    status: 'GENERADA',
    checkoutUrl: `https://checkout.helipagos.com/pay/${providerPaymentId}`,
    shortUrl: 'https://hpg.ar/abc123',
    barcode: '9876543210123',
    expirationDate: '2026-12-31',
    amount: 150000,
    createdAt: '2026-05-17T00:00:00.000Z',
  };
}

function buildValidBody(externalReference: string) {
  return {
    amount: 150000,
    expirationDate: '2026-12-31',
    description: 'Patito de Goma',
    externalReference,
    redirectUrl: 'https://example.com/payment/result',
  };
}

// ─── Suite

describe('POST /api/payments', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let gateway: ReturnType<typeof getProviderGatewayMock>;
  let authToken: string;
  let server: Server;

  beforeAll(async () => {
    ({ app, moduleRef } = await createTestApp());
    gateway = getProviderGatewayMock(moduleRef);
    server = app.getHttpServer() as Server;

    // Obtain a JWT that will be reused across all tests in this suite.
    const loginRes = await request(server)
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'admin123' });

    authToken = (loginRes.body as LoginResponseBody).accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    // Remove per-test implementations so tests do not bleed into each other.
    gateway.createPayment.mockReset();
  });

  // ── Scenario 1

  it('should return 201 with payment data on valid request', async () => {
    const result = buildGatewayResult(200001);
    gateway.createPayment.mockResolvedValueOnce(result);

    const body = buildValidBody('order-e2e-create-001');

    const res = await request(server)
      .post('/api/payments')
      .set('Authorization', `Bearer ${authToken}`)
      .send(body);

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      externalPaymentId: result.providerPaymentId,
      externalReference: body.externalReference,
      amount: body.amount,
      description: body.description,
      status: 'GENERADA', // PaymentStatus.CREATED
      checkoutUrl: result.checkoutUrl,
    });
    const resBody = res.body as PaymentResponseBody;
    expect(resBody.id).toBeDefined();
    expect(resBody.createdAt).toBeDefined();
  });

  // ── Scenario 2

  it('should return 400 when externalReference is missing', async () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { externalReference: _ref, ...bodyWithoutRef } = buildValidBody(
      'order-e2e-missing-ref',
    );

    const res = await request(server)
      .post('/api/payments')
      .set('Authorization', `Bearer ${authToken}`)
      .send(bodyWithoutRef);

    expect(res.status).toBe(400);
    expect(gateway.createPayment).not.toHaveBeenCalled();
  });

  // ── Scenario 3

  it('should return 400 when amount is not a number', async () => {
    const res = await request(server)
      .post('/api/payments')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        ...buildValidBody('order-e2e-invalid-amount'),
        amount: 'not-a-number',
      });

    expect(res.status).toBe(400);
    expect(gateway.createPayment).not.toHaveBeenCalled();
  });

  // ── Scenario 4

  it('should return 201 with the same payment on duplicate externalReference (idempotency)', async () => {
    gateway.createPayment.mockResolvedValueOnce(buildGatewayResult(200004));

    const body = buildValidBody('order-e2e-idempotent-001');

    // First call — creates the payment and hits the provider.
    const firstRes = await request(server)
      .post('/api/payments')
      .set('Authorization', `Bearer ${authToken}`)
      .send(body);

    expect(firstRes.status).toBe(201);

    // Second call — same reference, must return the existing payment without
    // calling the provider again.
    const secondRes = await request(server)
      .post('/api/payments')
      .set('Authorization', `Bearer ${authToken}`)
      .send(body);

    expect(secondRes.status).toBe(201);
    expect((secondRes.body as PaymentResponseBody).id).toBe(
      (firstRes.body as PaymentResponseBody).id,
    );
    expect(gateway.createPayment).toHaveBeenCalledTimes(1);
  });

  // ── Scenario 5

  it('should return 503 when the provider gateway throws HelipagosUnavailableError', async () => {
    gateway.createPayment.mockRejectedValueOnce(
      new HelipagosUnavailableError(),
    );

    const res = await request(server)
      .post('/api/payments')
      .set('Authorization', `Bearer ${authToken}`)
      .send(buildValidBody('order-e2e-unavailable-001'));

    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({
      statusCode: 503,
      error: 'HelipagosUnavailableError',
    });
  });

  // ── Scenario 5b

  it('should return 503 with HelipagosAuthenticationError when provider rejects authentication', async () => {
    gateway.createPayment.mockRejectedValueOnce(
      new HelipagosAuthenticationError(),
    );

    const res = await request(server)
      .post('/api/payments')
      .set('Authorization', `Bearer ${authToken}`)
      .send(buildValidBody('order-e2e-auth-err-001'));

    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({
      statusCode: 503,
      error: 'HelipagosAuthenticationError',
      message: 'Payment provider authentication failed.',
    });
    // Never expose stack traces in the response
    expect(res.body).not.toHaveProperty('stack');
  });

  // ── Scenario 5c

  it('should retry provider on second POST when previous attempt left a PENDING payment', async () => {
    const externalReference = 'order-e2e-retry-recovery-001';
    const result = buildGatewayResult(200099);

    // First call: provider authentication fails — 503, local PENDING payment created.
    gateway.createPayment.mockRejectedValueOnce(
      new HelipagosAuthenticationError(),
    );

    const firstRes = await request(server)
      .post('/api/payments')
      .set('Authorization', `Bearer ${authToken}`)
      .send(buildValidBody(externalReference));

    expect(firstRes.status).toBe(503);

    // Second call: same externalReference, provider now succeeds — uses existing PENDING record.
    gateway.createPayment.mockResolvedValueOnce(result);

    const secondRes = await request(server)
      .post('/api/payments')
      .set('Authorization', `Bearer ${authToken}`)
      .send(buildValidBody(externalReference));

    expect(secondRes.status).toBe(201);
    const body = secondRes.body as PaymentResponseBody;
    expect(body.externalPaymentId).toBe(result.providerPaymentId);
    expect(body.externalReference).toBe(externalReference);
    // Provider called exactly once per attempt (no extra calls)
    expect(gateway.createPayment).toHaveBeenCalledTimes(2);
  });

  // ── Scenario 6

  it('should return 401 when no JWT is provided', async () => {
    const res = await request(server)
      .post('/api/payments')
      .send(buildValidBody('order-e2e-no-auth-001'));

    expect(res.status).toBe(401);
    expect(gateway.createPayment).not.toHaveBeenCalled();
  });

  // ── Scenario 7

  it('should return 400 when surcharge is a decimal (must be integer cents)', async () => {
    const res = await request(server)
      .post('/api/payments')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        ...buildValidBody('order-e2e-decimal-surcharge'),
        surcharge: 5.5,
      });

    expect(res.status).toBe(400);
    expect(gateway.createPayment).not.toHaveBeenCalled();
  });

  // ── Scenario 8

  it('should forward surcharge, secondExpirationDate and secondaryReference to the provider gateway', async () => {
    gateway.createPayment.mockResolvedValueOnce(buildGatewayResult(200008));

    const body = {
      ...buildValidBody('order-e2e-optional-fields-001'),
      surcharge: 500,
      secondExpirationDate: '2027-01-15',
      secondaryReference: 'invoice-456',
    };

    const res = await request(server)
      .post('/api/payments')
      .set('Authorization', `Bearer ${authToken}`)
      .send(body);

    expect(res.status).toBe(201);
    expect(gateway.createPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        surcharge: 500,
        secondExpirationDate: '2027-01-15',
        secondaryReference: 'invoice-456',
      }),
    );
  });
});

// ── Webhook URL resolution — WEBHOOK_URL configured ───────────────────────────
//
// A separate app is created here with a controlled WEBHOOK_URL so assertions
// can reference a known value instead of the one from .env.test.
// The process.env value is set BEFORE createTestApp() because NestJS ConfigModule
// uses dotenv, which does NOT overwrite already-set process.env variables.

describe('POST /api/payments — WEBHOOK_URL override', () => {
  const CONTROLLED_WEBHOOK_URL =
    'https://controlled.example.com/api/payments/webhook';
  const WRONG_BODY_WEBHOOK_URL =
    'https://wrong.example.com/api/payments/webhooks'; // note: "webhooks" plural

  let app: INestApplication;
  let moduleRef: TestingModule;
  let gateway: ReturnType<typeof getProviderGatewayMock>;
  let authToken: string;
  let server: Server;
  let originalWebhookUrl: string | undefined;

  beforeAll(async () => {
    // Persist whatever value was already in process.env so we can restore it.
    originalWebhookUrl = process.env.WEBHOOK_URL;
    // Override BEFORE createTestApp() — dotenv will skip this key when loading
    // .env.test because it does not overwrite already-defined env vars.
    process.env.WEBHOOK_URL = CONTROLLED_WEBHOOK_URL;

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
    // Restore so subsequent test suites see the original value.
    if (originalWebhookUrl !== undefined) {
      process.env.WEBHOOK_URL = originalWebhookUrl;
    } else {
      delete process.env.WEBHOOK_URL;
    }
  });

  beforeEach(() => {
    gateway.createPayment.mockReset();
  });

  // ── Scenario W1

  it('should forward WEBHOOK_URL from env to provider, ignoring a wrong body webhookUrl', async () => {
    gateway.createPayment.mockResolvedValueOnce(buildGatewayResult(300001));

    const res = await request(server)
      .post('/api/payments')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        ...buildValidBody('order-e2e-webhook-override-001'),
        webhookUrl: WRONG_BODY_WEBHOOK_URL,
      });

    expect(res.status).toBe(201);
    expect(gateway.createPayment).toHaveBeenCalledWith(
      expect.objectContaining({ webhookUrl: CONTROLLED_WEBHOOK_URL }),
    );
    expect(gateway.createPayment).not.toHaveBeenCalledWith(
      expect.objectContaining({ webhookUrl: WRONG_BODY_WEBHOOK_URL }),
    );
  });

  // ── Scenario W2

  it('should use WEBHOOK_URL from env even when body omits webhookUrl', async () => {
    gateway.createPayment.mockResolvedValueOnce(buildGatewayResult(300002));

    const res = await request(server)
      .post('/api/payments')
      .set('Authorization', `Bearer ${authToken}`)
      .send(buildValidBody('order-e2e-webhook-override-002'));

    expect(res.status).toBe(201);
    expect(gateway.createPayment).toHaveBeenCalledWith(
      expect.objectContaining({ webhookUrl: CONTROLLED_WEBHOOK_URL }),
    );
  });
});
