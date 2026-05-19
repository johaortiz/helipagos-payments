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

interface PaymentResponseBody {
  id: string;
  externalPaymentId: number;
  externalReference: string;
  status: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildGatewayResult(providerPaymentId: number): CreatePaymentResult {
  return {
    providerPaymentId,
    status: 'GENERADA',
    checkoutUrl: `https://checkout.helipagos.com/pay/${providerPaymentId}`,
    shortUrl: 'https://hpg.ar/cancel-test',
    barcode: '1234567890',
    expirationDate: '2026-12-31',
    amount: 150000,
    createdAt: '2026-05-18T00:00:00.000Z',
  };
}

function buildPaymentBody(externalReference: string) {
  return {
    amount: 150000,
    expirationDate: '2026-12-31',
    description: 'Cancel E2E test',
    externalReference,
    redirectUrl: 'https://example.com/payment/result',
  };
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('DELETE /api/payments/:id', () => {
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
    gateway.cancelPayment.mockReset();
  });

  // ── 1 ─────────────────────────────────────────────────────────────────────

  it('should return 200 when cancelling a CREATED payment', async () => {
    const providerPaymentId = 400001;
    gateway.createPayment.mockResolvedValueOnce(
      buildGatewayResult(providerPaymentId),
    );
    gateway.cancelPayment.mockResolvedValueOnce({
      success: true,
      message: 'Payment cancelled.',
    });

    const createRes = await request(server)
      .post('/api/payments')
      .set('Authorization', `Bearer ${authToken}`)
      .send(buildPaymentBody('cancel-e2e-created-001'));

    expect(createRes.status).toBe(201);
    const { id } = createRes.body as PaymentResponseBody;

    const cancelRes = await request(server)
      .delete(`/api/payments/${id}`)
      .set('Authorization', `Bearer ${authToken}`);

    expect(cancelRes.status).toBe(200);
  });

  // ── 2 ─────────────────────────────────────────────────────────────────────

  it('should return 422 with PaymentDomainError when cancelling a PROCESSED payment', async () => {
    const providerPaymentId = 400002;
    const externalReference = 'cancel-e2e-processed-001';

    // Seed a CREATED payment.
    gateway.createPayment.mockResolvedValueOnce(
      buildGatewayResult(providerPaymentId),
    );
    const createRes = await request(server)
      .post('/api/payments')
      .set('Authorization', `Bearer ${authToken}`)
      .send(buildPaymentBody(externalReference));

    expect(createRes.status).toBe(201);
    const { id } = createRes.body as PaymentResponseBody;

    // Advance the payment to PROCESSED via webhook.
    const webhookRes = await request(server)
      .post('/api/payments/webhook')
      .send({
        id_sp: providerPaymentId,
        estado: 'PROCESADA',
        referencia_externa: externalReference,
      });

    expect(webhookRes.status).toBe(200);

    // Now cancel — must fail with 422 (domain rule: cannot cancel PROCESSED).
    const cancelRes = await request(server)
      .delete(`/api/payments/${id}`)
      .set('Authorization', `Bearer ${authToken}`);

    expect(cancelRes.status).toBe(422);
    expect(cancelRes.body).toMatchObject({
      statusCode: 422,
      error: 'PaymentDomainError',
    });
    expect((cancelRes.body as { message: string }).message).toContain(
      'Cannot cancel a payment with status',
    );
  });

  // ── 3 ─────────────────────────────────────────────────────────────────────

  it('should return 404 when the payment does not exist', async () => {
    const cancelRes = await request(server)
      .delete('/api/payments/00000000-0000-4000-8000-000000000000')
      .set('Authorization', `Bearer ${authToken}`);

    expect(cancelRes.status).toBe(404);
    expect(cancelRes.body).toMatchObject({
      statusCode: 404,
      error: 'PaymentNotFoundException',
    });
  });

  // ── 4 ─────────────────────────────────────────────────────────────────────

  it('should return 401 when no JWT is provided', async () => {
    const cancelRes = await request(server).delete(
      '/api/payments/00000000-0000-4000-8000-000000000001',
    );

    expect(cancelRes.status).toBe(401);
  });
});
