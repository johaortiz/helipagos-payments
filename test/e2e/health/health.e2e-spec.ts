import type { Server } from 'node:http';

import { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { createTestApp } from '../helpers/test-app.factory';

// Module compilation can take several seconds in CI.
jest.setTimeout(30_000);

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('Health endpoints', () => {
  let app: INestApplication;
  let server: Server;

  beforeAll(async () => {
    ({ app } = await createTestApp());
    server = app.getHttpServer() as Server;
  });

  afterAll(async () => {
    await app.close();
  });

  // ── GET /api/health ────────────────────────────────────────────────────────

  it('GET /api/health should return 200 without JWT', async () => {
    const res = await request(server).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'ok',
      environment: 'test',
    });
    const body = res.body as { timestamp: unknown; uptime: unknown };
    expect(typeof body.timestamp).toBe('string');
    expect(typeof body.uptime).toBe('number');
  });

  // ── GET /api/health/ready ──────────────────────────────────────────────────

  it('GET /api/health/ready should return 200 without JWT when DB is available', async () => {
    const res = await request(server).get('/api/health/ready');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'ready',
      database: 'up',
    });
    const body = res.body as { timestamp: unknown };
    expect(typeof body.timestamp).toBe('string');
  });
});
