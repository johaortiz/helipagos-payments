import type { Server } from 'node:http';

import { INestApplication } from '@nestjs/common';
import { TestingModule } from '@nestjs/testing';
import request from 'supertest';

import { CreatePaymentResult } from '../../../src/contexts/payments/domain/gateways/payment-provider.gateway';
import { HelipagosUnavailableError } from '../../../src/contexts/payments/infrastructure/http/helipagos-http.client';
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

const VALID_GATEWAY_RESULT: CreatePaymentResult = {
  providerPaymentId: 987654,
  status: 'GENERADA',
  checkoutUrl: 'https://checkout.helipagos.com/pay/987654',
  shortUrl: 'https://hpg.ar/abc123',
  barcode: '9876543210123',
  expirationDate: '2026-12-31',
  amount: 150000,
  createdAt: '2026-05-17T00:00:00.000Z',
};

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
    gateway.createPayment.mockResolvedValueOnce(VALID_GATEWAY_RESULT);

    const body = buildValidBody('order-e2e-create-001');

    const res = await request(server)
      .post('/api/payments')
      .set('Authorization', `Bearer ${authToken}`)
      .send(body);

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      externalPaymentId: VALID_GATEWAY_RESULT.providerPaymentId,
      externalReference: body.externalReference,
      amount: body.amount,
      description: body.description,
      status: 'GENERADA', // PaymentStatus.CREATED
      checkoutUrl: VALID_GATEWAY_RESULT.checkoutUrl,
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
    gateway.createPayment.mockResolvedValueOnce(VALID_GATEWAY_RESULT);

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
    gateway.createPayment.mockResolvedValueOnce(VALID_GATEWAY_RESULT);

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
