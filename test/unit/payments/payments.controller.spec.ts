import { ConfigService } from '@nestjs/config';

import { CreatePaymentInput } from '../../../src/contexts/payments/application/dto/create-payment.input';
import { CreatePaymentOutput } from '../../../src/contexts/payments/application/dto/create-payment.output';
import { CancelPaymentUseCase } from '../../../src/contexts/payments/application/uses-cases/cancel-payment.use-case';
import { CreatePaymentUseCase } from '../../../src/contexts/payments/application/uses-cases/create-payment.use-case';
import { GetPaymentUseCase } from '../../../src/contexts/payments/application/uses-cases/get-payment.use-case';
import { HandlePaymentWebhookUseCase } from '../../../src/contexts/payments/application/uses-cases/handle-payment-webhook.use-case';
import { LookupPaymentUseCase } from '../../../src/contexts/payments/application/uses-cases/lookup-payment.use-case';
import { PaymentStatus } from '../../../src/contexts/payments/domain/enums/payment-status.enum';
import { CreatePaymentDto } from '../../../src/contexts/payments/presentation/dto/create-payment.dto';
import { PaymentsController } from '../../../src/contexts/payments/presentation/controllers/payments.controller';

// ── Helpers ───────────────────────────────────────────────────────────────────

// Plain mock objects (not jest.Mocked<Class>) to avoid the unbound-method lint
// rule firing on expect(mock.method).toHaveBeenCalledWith(...) assertions.

function buildMockCreateUseCase() {
  return {
    execute: jest.fn<Promise<CreatePaymentOutput>, [CreatePaymentInput]>(),
  };
}

function buildIdleMock() {
  return { execute: jest.fn() };
}

function buildConfigService(webhookUrl: string | undefined): ConfigService {
  return {
    get: jest.fn((key: string) =>
      key === 'WEBHOOK_URL' ? webhookUrl : undefined,
    ),
  } as unknown as ConfigService;
}

const STUB_OUTPUT: CreatePaymentOutput = {
  id: 'test-uuid-001',
  externalPaymentId: 42,
  externalReference: 'order-ctrl-test-001',
  status: PaymentStatus.CREATED,
  checkoutUrl: 'https://checkout.helipagos.com/pay/42',
  shortUrl: 'https://hpg.ar/xyz',
  barCode: '1234567890',
  amount: 100000,
  expirationDate: '2026-12-31',
  createdAt: new Date('2026-05-19T00:00:00.000Z'),
};

function buildDto(overrides: Partial<CreatePaymentDto> = {}): CreatePaymentDto {
  return {
    amount: 100000,
    expirationDate: '2026-12-31',
    description: 'Test payment',
    externalReference: 'order-ctrl-test-001',
    redirectUrl: 'https://example.com/return',
    ...overrides,
  };
}

function buildController(
  createUseCase: ReturnType<typeof buildMockCreateUseCase>,
  configService: ConfigService,
): PaymentsController {
  return new PaymentsController(
    createUseCase as unknown as CreatePaymentUseCase,
    buildIdleMock() as unknown as GetPaymentUseCase,
    buildIdleMock() as unknown as CancelPaymentUseCase,
    buildIdleMock() as unknown as HandlePaymentWebhookUseCase,
    buildIdleMock() as unknown as LookupPaymentUseCase,
    configService,
  );
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('PaymentsController — webhook URL resolution', () => {
  // ── 1 ── WEBHOOK_URL not configured, body has webhookUrl → body URL forwarded

  it('forwards dto.webhookUrl to the use case when WEBHOOK_URL env is not configured', async () => {
    const createUseCase = buildMockCreateUseCase();
    createUseCase.execute.mockResolvedValue(STUB_OUTPUT);
    const controller = buildController(
      createUseCase,
      buildConfigService(undefined),
    );

    await controller.create(
      buildDto({
        webhookUrl: 'https://client.example.com/api/payments/webhook',
      }),
    );

    expect(createUseCase.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        webhookUrl: 'https://client.example.com/api/payments/webhook',
      }),
    );
  });

  // ── 2 ── WEBHOOK_URL configured, body also has a URL → env URL takes priority

  it('uses WEBHOOK_URL env over dto.webhookUrl when both are present', async () => {
    const createUseCase = buildMockCreateUseCase();
    createUseCase.execute.mockResolvedValue(STUB_OUTPUT);
    const controller = buildController(
      createUseCase,
      buildConfigService('https://server.example.com/api/payments/webhook'),
    );

    await controller.create(
      buildDto({
        webhookUrl: 'https://wrong.example.com/api/payments/webhooks',
      }),
    );

    expect(createUseCase.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        webhookUrl: 'https://server.example.com/api/payments/webhook',
      }),
    );
    expect(createUseCase.execute).not.toHaveBeenCalledWith(
      expect.objectContaining({
        webhookUrl: 'https://wrong.example.com/api/payments/webhooks',
      }),
    );
  });

  // ── 3 ── WEBHOOK_URL is whitespace-only → treated as unconfigured, body URL used

  it('treats a whitespace-only WEBHOOK_URL as not configured and falls back to dto.webhookUrl', async () => {
    const createUseCase = buildMockCreateUseCase();
    createUseCase.execute.mockResolvedValue(STUB_OUTPUT);
    const controller = buildController(
      createUseCase,
      buildConfigService('   '),
    );

    await controller.create(
      buildDto({
        webhookUrl: 'https://client.example.com/api/payments/webhook',
      }),
    );

    expect(createUseCase.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        webhookUrl: 'https://client.example.com/api/payments/webhook',
      }),
    );
  });

  // ── 4 ── Neither WEBHOOK_URL nor body webhookUrl → use case receives undefined

  it('passes undefined webhookUrl when neither env nor body provides one', async () => {
    const createUseCase = buildMockCreateUseCase();
    createUseCase.execute.mockResolvedValue(STUB_OUTPUT);
    const controller = buildController(
      createUseCase,
      buildConfigService(undefined),
    );

    await controller.create(buildDto()); // no webhookUrl

    expect(createUseCase.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        webhookUrl: undefined,
      }),
    );
  });
});
