import type { Server } from 'node:http';

import { INestApplication } from '@nestjs/common';
import { TestingModule } from '@nestjs/testing';
import request from 'supertest';

import { HandlePaymentWebhookUseCase } from '../../../src/contexts/payments/application/uses-cases/handle-payment-webhook.use-case';
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

  // ── Scenario 7: validation disabled ─────────────────────────────────────────

  it('should return 200 and process webhook when HELIPAGOS_WEBHOOK_SECRET is not configured (any header value is ignored)', async () => {
    // HELIPAGOS_WEBHOOK_SECRET is absent from the test environment.
    // A secret header sent by the caller must be ignored entirely.
    const idSp = await seedPayment('wh-e2e-no-secret-007', 300007);

    const res = await request(server)
      .post('/api/payments/webhook')
      .set('x-webhook-secret', 'any-value-should-be-ignored')
      .send(buildWebhookBody(idSp, 'PROCESADA', 'wh-e2e-no-secret-007'));

    expect(res.status).toBe(200);
  });
});

// ─── Secret header validation suite ──────────────────────────────────────────
// Each inner describe creates its own NestJS app with specific env vars so
// ConfigService sees a different configuration per group.
//
// Assertions spy on HandlePaymentWebhookUseCase.execute directly — this avoids
// exercising GetPaymentUseCase (which calls providerGateway.getPayment and would
// crash when the mock returns null for that method).

describe('POST /api/payments/webhook — secret header validation', () => {
  const WEBHOOK_SECRET = 'test-webhook-secret-xyz';

  // id_sp that does not exist in the DB — HandlePaymentWebhookUseCase handles
  // "not found" gracefully (logs a warning and returns), so execute() completes
  // without throwing regardless of whether the secret is correct.
  const UNKNOWN_ID_SP = 999_999;

  // ── Group A: default header name (x-webhook-secret) ──────────────────────

  describe('default header name (x-webhook-secret)', () => {
    let app: INestApplication;
    let moduleRef: TestingModule;
    let server: Server;
    let webhookUseCase: HandlePaymentWebhookUseCase;
    let executeSpy: jest.SpyInstance;

    beforeAll(async () => {
      // Set before createTestApp() so ConfigService picks it up from process.env.
      process.env['HELIPAGOS_WEBHOOK_SECRET'] = WEBHOOK_SECRET;
      // HELIPAGOS_WEBHOOK_SECRET_HEADER left unset → controller falls back to 'x-webhook-secret'.

      ({ app, moduleRef } = await createTestApp());
      webhookUseCase = moduleRef.get(HandlePaymentWebhookUseCase);
      server = app.getHttpServer() as Server;
    });

    afterAll(async () => {
      await app.close();
      delete process.env['HELIPAGOS_WEBHOOK_SECRET'];
    });

    beforeEach(() => {
      // Fresh spy each test — call count resets automatically via restoreAllMocks.
      executeSpy = jest.spyOn(webhookUseCase, 'execute');
      jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      jest.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    // ── A1 ────────────────────────────────────────────────────────────────────

    it('should return 200 and invoke the use case when the correct secret header is sent', async () => {
      const res = await request(server)
        .post('/api/payments/webhook')
        .set('x-webhook-secret', WEBHOOK_SECRET)
        .send(buildWebhookBody(UNKNOWN_ID_SP, 'PROCESADA', 'wh-sec-a1'));

      expect(res.status).toBe(200);
      expect(executeSpy).toHaveBeenCalledTimes(1);
    });

    // ── A2 ────────────────────────────────────────────────────────────────────

    it('should return 200 and NOT invoke the use case when an incorrect secret is sent', async () => {
      const res = await request(server)
        .post('/api/payments/webhook')
        .set('x-webhook-secret', 'wrong-secret-value')
        .send(buildWebhookBody(UNKNOWN_ID_SP, 'PROCESADA', 'wh-sec-a2'));

      expect(res.status).toBe(200);
      expect(executeSpy).not.toHaveBeenCalled();
    });

    // ── A3 ────────────────────────────────────────────────────────────────────

    it('should return 200 and invoke the use case when the secret header is absent (validation skipped)', async () => {
      // Validation only triggers when the header IS present AND its value is wrong.
      // An absent header means the provider chose not to send it — skip and process normally.
      const res = await request(server)
        .post('/api/payments/webhook')
        // No secret header set.
        .send(buildWebhookBody(UNKNOWN_ID_SP, 'PROCESADA', 'wh-sec-a3'));

      expect(res.status).toBe(200);
      expect(executeSpy).toHaveBeenCalledTimes(1);
    });
  });

  // ── Group B: custom header name (HELIPAGOS_WEBHOOK_SECRET_HEADER) ─────────

  describe('custom header name (HELIPAGOS_WEBHOOK_SECRET_HEADER)', () => {
    const CUSTOM_HEADER = 'x-helipagos-signature';

    let app: INestApplication;
    let moduleRef: TestingModule;
    let server: Server;
    let webhookUseCase: HandlePaymentWebhookUseCase;
    let executeSpy: jest.SpyInstance;

    beforeAll(async () => {
      process.env['HELIPAGOS_WEBHOOK_SECRET'] = WEBHOOK_SECRET;
      process.env['HELIPAGOS_WEBHOOK_SECRET_HEADER'] = CUSTOM_HEADER;

      ({ app, moduleRef } = await createTestApp());
      webhookUseCase = moduleRef.get(HandlePaymentWebhookUseCase);
      server = app.getHttpServer() as Server;
    });

    afterAll(async () => {
      await app.close();
      delete process.env['HELIPAGOS_WEBHOOK_SECRET'];
      delete process.env['HELIPAGOS_WEBHOOK_SECRET_HEADER'];
    });

    beforeEach(() => {
      executeSpy = jest.spyOn(webhookUseCase, 'execute');
      jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      jest.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    // ── B1 ────────────────────────────────────────────────────────────────────

    it('should return 200 and invoke the use case when the correct value is in the custom header', async () => {
      const res = await request(server)
        .post('/api/payments/webhook')
        .set(CUSTOM_HEADER, WEBHOOK_SECRET)
        .send(buildWebhookBody(UNKNOWN_ID_SP, 'PROCESADA', 'wh-custom-b1'));

      expect(res.status).toBe(200);
      expect(executeSpy).toHaveBeenCalledTimes(1);
    });

    // ── B2 ────────────────────────────────────────────────────────────────────

    it('should return 200 and NOT invoke the use case when a wrong value is in the custom header', async () => {
      const res = await request(server)
        .post('/api/payments/webhook')
        .set(CUSTOM_HEADER, 'tampered-value')
        .send(buildWebhookBody(UNKNOWN_ID_SP, 'PROCESADA', 'wh-custom-b2'));

      expect(res.status).toBe(200);
      expect(executeSpy).not.toHaveBeenCalled();
    });

    // ── B3 ────────────────────────────────────────────────────────────────────

    it('should return 200 and invoke the use case when the configured custom header is absent (wrong header name sent)', async () => {
      // The controller looks at CUSTOM_HEADER, not 'x-webhook-secret'.
      // Sending the default header name is invisible to the validation logic —
      // the configured header (CUSTOM_HEADER) is absent → validation skipped → processed.
      const res = await request(server)
        .post('/api/payments/webhook')
        .set('x-webhook-secret', WEBHOOK_SECRET) // wrong header name — custom header absent
        .send(buildWebhookBody(UNKNOWN_ID_SP, 'PROCESADA', 'wh-custom-b3'));

      expect(res.status).toBe(200);
      expect(executeSpy).toHaveBeenCalledTimes(1);
    });
  });
});
