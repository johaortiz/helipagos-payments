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
// process.env values set before createTestApp() override .env.test because
// dotenv (used by NestJS ConfigModule) does NOT overwrite existing process.env
// entries (no override:true). Cleanup in afterAll() restores the prior state.
//
// Assertions spy on HandlePaymentWebhookUseCase.execute — this avoids
// exercising GetPaymentUseCase (which calls providerGateway.getPayment and
// would crash when the mock returns null for that method).
//
// Groups follow the specification:
//   A. Secret not configured — validation skipped entirely
//   B. Secret configured, REQUIRED=true (default) — absent header rejects request
//   C. Secret configured, REQUIRED=false — absent header processes normally
//   D. Custom header name — tests REQUIRED interaction with custom header

describe('POST /api/payments/webhook — secret header validation', () => {
  const WEBHOOK_SECRET = 'test-webhook-secret-xyz';

  // id_sp that does not exist in the DB — HandlePaymentWebhookUseCase handles
  // "not found" gracefully (logs a warning and returns), so execute() completes
  // without throwing regardless of whether the secret is correct.
  const UNKNOWN_ID_SP = 999_999;

  // ── Group A: HELIPAGOS_WEBHOOK_SECRET not configured ─────────────────────

  describe('Group A: secret not configured', () => {
    let app: INestApplication;
    let moduleRef: TestingModule;
    let server: Server;
    let webhookUseCase: HandlePaymentWebhookUseCase;
    let executeSpy: jest.SpyInstance;

    beforeAll(async () => {
      // Override .env.test value with empty string — empty string is falsy so
      // configService.get('HELIPAGOS_WEBHOOK_SECRET') returns '' and the
      // validation block is skipped entirely.
      process.env['HELIPAGOS_WEBHOOK_SECRET'] = '';

      ({ app, moduleRef } = await createTestApp());
      webhookUseCase = moduleRef.get(HandlePaymentWebhookUseCase);
      server = app.getHttpServer() as Server;
    });

    afterAll(async () => {
      await app.close();
      delete process.env['HELIPAGOS_WEBHOOK_SECRET'];
    });

    beforeEach(() => {
      executeSpy = jest.spyOn(webhookUseCase, 'execute');
      jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      jest.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    // ── A1 ────────────────────────────────────────────────────────────────────

    it('should return 200 and invoke the use case when no apikey header is sent', async () => {
      const res = await request(server)
        .post('/api/payments/webhook')
        .send(buildWebhookBody(UNKNOWN_ID_SP, 'PROCESADA', 'wh-a1'));

      expect(res.status).toBe(200);
      expect(executeSpy).toHaveBeenCalledTimes(1);
    });

    // ── A2 ────────────────────────────────────────────────────────────────────

    it('should return 200 and invoke the use case when any apikey header value is sent (no validation)', async () => {
      const res = await request(server)
        .post('/api/payments/webhook')
        .set('apikey', 'any-arbitrary-value')
        .send(buildWebhookBody(UNKNOWN_ID_SP, 'PROCESADA', 'wh-a2'));

      expect(res.status).toBe(200);
      expect(executeSpy).toHaveBeenCalledTimes(1);
    });
  });

  // ── Group B: secret configured, REQUIRED=true ─────────────────────────────

  describe('Group B: secret configured, REQUIRED=true (default apikey header)', () => {
    let app: INestApplication;
    let moduleRef: TestingModule;
    let server: Server;
    let webhookUseCase: HandlePaymentWebhookUseCase;
    let executeSpy: jest.SpyInstance;

    beforeAll(async () => {
      process.env['HELIPAGOS_WEBHOOK_SECRET'] = WEBHOOK_SECRET;
      process.env['HELIPAGOS_WEBHOOK_SECRET_HEADER'] = 'apikey';
      process.env['HELIPAGOS_WEBHOOK_SECRET_REQUIRED'] = 'true';

      ({ app, moduleRef } = await createTestApp());
      webhookUseCase = moduleRef.get(HandlePaymentWebhookUseCase);
      server = app.getHttpServer() as Server;
    });

    afterAll(async () => {
      await app.close();
      delete process.env['HELIPAGOS_WEBHOOK_SECRET'];
      delete process.env['HELIPAGOS_WEBHOOK_SECRET_HEADER'];
      delete process.env['HELIPAGOS_WEBHOOK_SECRET_REQUIRED'];
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

    it('should return 200 and invoke the use case when the correct apikey is sent', async () => {
      const res = await request(server)
        .post('/api/payments/webhook')
        .set('apikey', WEBHOOK_SECRET)
        .send(buildWebhookBody(UNKNOWN_ID_SP, 'PROCESADA', 'wh-b1'));

      expect(res.status).toBe(200);
      expect(executeSpy).toHaveBeenCalledTimes(1);
    });

    // ── B2 ────────────────────────────────────────────────────────────────────

    it('should return 200 and NOT invoke the use case when a wrong apikey is sent', async () => {
      const res = await request(server)
        .post('/api/payments/webhook')
        .set('apikey', 'wrong-secret-value')
        .send(buildWebhookBody(UNKNOWN_ID_SP, 'PROCESADA', 'wh-b2'));

      expect(res.status).toBe(200);
      expect(executeSpy).not.toHaveBeenCalled();
    });

    // ── B3 ────────────────────────────────────────────────────────────────────

    it('should return 200 and NOT invoke the use case when the apikey header is absent (REQUIRED=true)', async () => {
      const res = await request(server)
        .post('/api/payments/webhook')
        .send(buildWebhookBody(UNKNOWN_ID_SP, 'PROCESADA', 'wh-b3'));

      expect(res.status).toBe(200);
      expect(executeSpy).not.toHaveBeenCalled();
    });
  });

  // ── Group C: secret configured, REQUIRED=false ────────────────────────────

  describe('Group C: secret configured, REQUIRED=false (default apikey header)', () => {
    let app: INestApplication;
    let moduleRef: TestingModule;
    let server: Server;
    let webhookUseCase: HandlePaymentWebhookUseCase;
    let executeSpy: jest.SpyInstance;

    beforeAll(async () => {
      process.env['HELIPAGOS_WEBHOOK_SECRET'] = WEBHOOK_SECRET;
      process.env['HELIPAGOS_WEBHOOK_SECRET_HEADER'] = 'apikey';
      process.env['HELIPAGOS_WEBHOOK_SECRET_REQUIRED'] = 'false';

      ({ app, moduleRef } = await createTestApp());
      webhookUseCase = moduleRef.get(HandlePaymentWebhookUseCase);
      server = app.getHttpServer() as Server;
    });

    afterAll(async () => {
      await app.close();
      delete process.env['HELIPAGOS_WEBHOOK_SECRET'];
      delete process.env['HELIPAGOS_WEBHOOK_SECRET_HEADER'];
      delete process.env['HELIPAGOS_WEBHOOK_SECRET_REQUIRED'];
    });

    beforeEach(() => {
      executeSpy = jest.spyOn(webhookUseCase, 'execute');
      jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      jest.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    // ── C1 ────────────────────────────────────────────────────────────────────

    it('should return 200 and invoke the use case when the correct apikey is sent', async () => {
      const res = await request(server)
        .post('/api/payments/webhook')
        .set('apikey', WEBHOOK_SECRET)
        .send(buildWebhookBody(UNKNOWN_ID_SP, 'PROCESADA', 'wh-c1'));

      expect(res.status).toBe(200);
      expect(executeSpy).toHaveBeenCalledTimes(1);
    });

    // ── C2 ────────────────────────────────────────────────────────────────────

    it('should return 200 and NOT invoke the use case when a wrong apikey is sent', async () => {
      const res = await request(server)
        .post('/api/payments/webhook')
        .set('apikey', 'wrong-secret-value')
        .send(buildWebhookBody(UNKNOWN_ID_SP, 'PROCESADA', 'wh-c2'));

      expect(res.status).toBe(200);
      expect(executeSpy).not.toHaveBeenCalled();
    });

    // ── C3 ────────────────────────────────────────────────────────────────────

    it('should return 200 and invoke the use case when the apikey header is absent (REQUIRED=false)', async () => {
      // REQUIRED=false means an absent header is accepted for compatibility.
      const res = await request(server)
        .post('/api/payments/webhook')
        .send(buildWebhookBody(UNKNOWN_ID_SP, 'PROCESADA', 'wh-c3'));

      expect(res.status).toBe(200);
      expect(executeSpy).toHaveBeenCalledTimes(1);
    });
  });

  // ── Group D: custom header name (HELIPAGOS_WEBHOOK_SECRET_HEADER) ─────────

  describe('Group D: custom header override (x-helipagos-signature)', () => {
    const CUSTOM_HEADER = 'x-helipagos-signature';

    // ── D REQUIRED=true ───────────────────────────────────────────────────────

    describe('REQUIRED=true', () => {
      let app: INestApplication;
      let moduleRef: TestingModule;
      let server: Server;
      let webhookUseCase: HandlePaymentWebhookUseCase;
      let executeSpy: jest.SpyInstance;

      beforeAll(async () => {
        process.env['HELIPAGOS_WEBHOOK_SECRET'] = WEBHOOK_SECRET;
        process.env['HELIPAGOS_WEBHOOK_SECRET_HEADER'] = CUSTOM_HEADER;
        process.env['HELIPAGOS_WEBHOOK_SECRET_REQUIRED'] = 'true';

        ({ app, moduleRef } = await createTestApp());
        webhookUseCase = moduleRef.get(HandlePaymentWebhookUseCase);
        server = app.getHttpServer() as Server;
      });

      afterAll(async () => {
        await app.close();
        delete process.env['HELIPAGOS_WEBHOOK_SECRET'];
        delete process.env['HELIPAGOS_WEBHOOK_SECRET_HEADER'];
        delete process.env['HELIPAGOS_WEBHOOK_SECRET_REQUIRED'];
      });

      beforeEach(() => {
        executeSpy = jest.spyOn(webhookUseCase, 'execute');
        jest.spyOn(console, 'warn').mockImplementation(() => undefined);
        jest.spyOn(console, 'error').mockImplementation(() => undefined);
      });

      afterEach(() => {
        jest.restoreAllMocks();
      });

      // ── D2 ──────────────────────────────────────────────────────────────────

      it('should return 200 and invoke the use case when the correct custom header is sent', async () => {
        const res = await request(server)
          .post('/api/payments/webhook')
          .set(CUSTOM_HEADER, WEBHOOK_SECRET)
          .send(buildWebhookBody(UNKNOWN_ID_SP, 'PROCESADA', 'wh-d2'));

        expect(res.status).toBe(200);
        expect(executeSpy).toHaveBeenCalledTimes(1);
      });

      // ── D3 ──────────────────────────────────────────────────────────────────

      it('should return 200 and NOT invoke the use case when apikey is sent but the custom header is absent (REQUIRED=true)', async () => {
        // The controller reads CUSTOM_HEADER, not 'apikey'.
        // Sending 'apikey' is irrelevant — the configured custom header is absent.
        // With REQUIRED=true the request is silently ignored.
        const res = await request(server)
          .post('/api/payments/webhook')
          .set('apikey', WEBHOOK_SECRET) // wrong header name — custom header absent
          .send(buildWebhookBody(UNKNOWN_ID_SP, 'PROCESADA', 'wh-d3'));

        expect(res.status).toBe(200);
        expect(executeSpy).not.toHaveBeenCalled();
      });
    });

    // ── D REQUIRED=false ──────────────────────────────────────────────────────

    describe('REQUIRED=false', () => {
      let app: INestApplication;
      let moduleRef: TestingModule;
      let server: Server;
      let webhookUseCase: HandlePaymentWebhookUseCase;
      let executeSpy: jest.SpyInstance;

      beforeAll(async () => {
        process.env['HELIPAGOS_WEBHOOK_SECRET'] = WEBHOOK_SECRET;
        process.env['HELIPAGOS_WEBHOOK_SECRET_HEADER'] = CUSTOM_HEADER;
        process.env['HELIPAGOS_WEBHOOK_SECRET_REQUIRED'] = 'false';

        ({ app, moduleRef } = await createTestApp());
        webhookUseCase = moduleRef.get(HandlePaymentWebhookUseCase);
        server = app.getHttpServer() as Server;
      });

      afterAll(async () => {
        await app.close();
        delete process.env['HELIPAGOS_WEBHOOK_SECRET'];
        delete process.env['HELIPAGOS_WEBHOOK_SECRET_HEADER'];
        delete process.env['HELIPAGOS_WEBHOOK_SECRET_REQUIRED'];
      });

      beforeEach(() => {
        executeSpy = jest.spyOn(webhookUseCase, 'execute');
        jest.spyOn(console, 'warn').mockImplementation(() => undefined);
        jest.spyOn(console, 'error').mockImplementation(() => undefined);
      });

      afterEach(() => {
        jest.restoreAllMocks();
      });

      // ── D4 ──────────────────────────────────────────────────────────────────

      it('should return 200 and invoke the use case when apikey is sent but the custom header is absent (REQUIRED=false)', async () => {
        // With REQUIRED=false, an absent custom header is accepted for compatibility.
        // The 'apikey' header is irrelevant — custom header is simply absent.
        const res = await request(server)
          .post('/api/payments/webhook')
          .set('apikey', WEBHOOK_SECRET) // wrong header name — custom header absent
          .send(buildWebhookBody(UNKNOWN_ID_SP, 'PROCESADA', 'wh-d4'));

        expect(res.status).toBe(200);
        expect(executeSpy).toHaveBeenCalledTimes(1);
      });
    });
  });
});
