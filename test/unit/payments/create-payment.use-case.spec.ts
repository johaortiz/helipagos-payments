import { CreatePaymentInput } from '../../../src/contexts/payments/application/dto/create-payment.input';
import { CreatePaymentUseCase } from '../../../src/contexts/payments/application/uses-cases/create-payment.use-case';
import { Payment } from '../../../src/contexts/payments/domain/entities/payment.entity';
import { PaymentStatus } from '../../../src/contexts/payments/domain/enums/payment-status.enum';
import { CreatePaymentResult } from '../../../src/contexts/payments/domain/gateways/payment-provider.gateway';
import {
  HelipagosAuthenticationError,
  HelipagosUnavailableError,
} from '../../../src/contexts/payments/infrastructure/http/helipagos-http.client';
import {
  createCreatedPaymentFixture,
  createPendingPaymentFixture,
} from '../../fixtures/payments/payment.fixture';
import { createMockProviderGateway } from '../../mocks/helipagos-http.client.mock';
import { createMockPaymentRepository } from '../../mocks/payment-repository.mock';

// ─── Shared test data ─────────────────────────────────────────────────────────

const VALID_INPUT: CreatePaymentInput = {
  amount: 150000,
  expirationDate: '2026-12-31',
  description: 'Monthly subscription payment',
  externalReference: 'order-test-001',
  redirectUrl: 'https://merchant.com/return',
  webhookUrl: 'https://merchant.com/webhook',
};

const PROVIDER_RESULT: CreatePaymentResult = {
  providerPaymentId: 987654,
  status: 'GENERADA',
  checkoutUrl: 'https://checkout.helipagos.com/pay/987654',
  shortUrl: 'https://hpg.ar/abc123',
  barcode: '1234567890123456',
  expirationDate: '2026-12-31',
  amount: 150000,
  createdAt: '2026-05-15T10:00:00.000Z',
};

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('CreatePaymentUseCase', () => {
  let useCase: CreatePaymentUseCase;
  let repository: ReturnType<typeof createMockPaymentRepository>;
  let providerGateway: ReturnType<typeof createMockProviderGateway>;

  beforeEach(() => {
    repository = createMockPaymentRepository();
    providerGateway = createMockProviderGateway();
    useCase = new CreatePaymentUseCase(repository, providerGateway);

    // Default happy-path stubs (new payment — no existing record)
    repository.findByExternalReference.mockResolvedValue(null);
    providerGateway.createPayment.mockResolvedValue(PROVIDER_RESULT);
  });

  // ── 1 ────────────────────────────────────────────────────────────────────────

  it('should create payment successfully and return the output DTO', async () => {
    const output = await useCase.execute(VALID_INPUT);

    expect(output.externalPaymentId).toBe(PROVIDER_RESULT.providerPaymentId);
    expect(output.externalReference).toBe(VALID_INPUT.externalReference);
    expect(output.status).toBe(PaymentStatus.CREATED);
    expect(output.checkoutUrl).toBe(PROVIDER_RESULT.checkoutUrl);
    expect(output.shortUrl).toBe(PROVIDER_RESULT.shortUrl);
    expect(output.barCode).toBe(PROVIDER_RESULT.barcode);
    expect(output.amount).toBe(VALID_INPUT.amount);
    expect(output.id).toBeDefined();
    expect(output.createdAt).toBeInstanceOf(Date);
  });

  // ── 2 ────────────────────────────────────────────────────────────────────────

  it('should persist payment as PENDING before calling the provider', async () => {
    let statusAtSaveTime: PaymentStatus | undefined;

    repository.save.mockImplementation((payment: Payment) => {
      statusAtSaveTime = payment.status;
      return Promise.resolve();
    });

    await useCase.execute(VALID_INPUT);

    expect(statusAtSaveTime).toBe(PaymentStatus.PENDING);
    expect(repository.save.mock.invocationCallOrder[0]).toBeLessThan(
      providerGateway.createPayment.mock.invocationCallOrder[0],
    );
  });

  // ── 3 ────────────────────────────────────────────────────────────────────────

  it('should update payment to CREATED status after provider confirms', async () => {
    let statusAtUpdateTime: PaymentStatus | undefined;
    let externalIdAtUpdateTime: number | null | undefined;

    repository.update.mockImplementation((payment: Payment) => {
      statusAtUpdateTime = payment.status;
      externalIdAtUpdateTime = payment.externalPaymentId;
      return Promise.resolve();
    });

    await useCase.execute(VALID_INPUT);

    expect(statusAtUpdateTime).toBe(PaymentStatus.CREATED);
    expect(externalIdAtUpdateTime).toBe(PROVIDER_RESULT.providerPaymentId);
    expect(repository.update).toHaveBeenCalledTimes(1);
  });

  // ── 4 ────────────────────────────────────────────────────────────────────────

  it('should return the existing payment when externalReference is duplicate and provider id is set', async () => {
    const existingPayment = createCreatedPaymentFixture({
      externalReference: VALID_INPUT.externalReference,
    });

    repository.findByExternalReference.mockResolvedValue(existingPayment);

    const output = await useCase.execute(VALID_INPUT);

    expect(output.id).toBe(existingPayment.id);
    expect(output.externalReference).toBe(existingPayment.externalReference);
    expect(output.status).toBe(existingPayment.status);
    expect(repository.save).not.toHaveBeenCalled();
  });

  // ── 5 ────────────────────────────────────────────────────────────────────────

  it('should NOT call the provider when the payment already has an externalPaymentId', async () => {
    const existingPayment = createCreatedPaymentFixture({
      externalReference: VALID_INPUT.externalReference,
    });

    repository.findByExternalReference.mockResolvedValue(existingPayment);

    await useCase.execute(VALID_INPUT);

    expect(providerGateway.createPayment).not.toHaveBeenCalled();
  });

  // ── 6 ────────────────────────────────────────────────────────────────────────

  it('should propagate errors thrown by the payment provider', async () => {
    const providerError = new Error('Helipagos service unavailable');
    providerGateway.createPayment.mockRejectedValue(providerError);

    await expect(useCase.execute(VALID_INPUT)).rejects.toThrow(
      'Helipagos service unavailable',
    );
  });

  // ── 7 ────────────────────────────────────────────────────────────────────────

  it('should keep the PENDING record in the DB and skip update when provider fails', async () => {
    providerGateway.createPayment.mockRejectedValue(
      new Error('Gateway timeout'),
    );

    await expect(useCase.execute(VALID_INPUT)).rejects.toThrow();

    expect(repository.save).toHaveBeenCalledTimes(1);
    expect(repository.update).not.toHaveBeenCalled();
  });

  // ── 8 ────────────────────────────────────────────────────────────────────────

  it('should handle empty string optional provider fields without throwing', async () => {
    const sparseResult: CreatePaymentResult = {
      ...PROVIDER_RESULT,
      checkoutUrl: '',
      shortUrl: '',
      barcode: '',
    };

    providerGateway.createPayment.mockResolvedValue(sparseResult);

    const output = await useCase.execute(VALID_INPUT);

    expect(output.checkoutUrl).toBe('');
    expect(output.shortUrl).toBe('');
    expect(output.barCode).toBe('');
    expect(output.externalPaymentId).toBe(PROVIDER_RESULT.providerPaymentId);
    expect(output.status).toBe(PaymentStatus.CREATED);
  });

  // ── 9 ────────────────────────────────────────────────────────────────────────

  it('should generate a unique UUID for each payment execution', async () => {
    const first = await useCase.execute(VALID_INPUT);
    const second = await useCase.execute({
      ...VALID_INPUT,
      externalReference: 'order-test-002',
    });

    expect(first.id).toBeDefined();
    expect(second.id).toBeDefined();
    expect(first.id).not.toBe(second.id);
  });

  // ── 10 ───────────────────────────────────────────────────────────────────────

  it('should call findByExternalReference before save on new payment', async () => {
    await useCase.execute(VALID_INPUT);

    expect(repository.findByExternalReference).toHaveBeenCalledTimes(1);
    expect(
      repository.findByExternalReference.mock.invocationCallOrder[0],
    ).toBeLessThan(repository.save.mock.invocationCallOrder[0]);
  });

  // ── 11 ───────────────────────────────────────────────────────────────────────

  it('should call findByExternalReference once per execute call', async () => {
    await useCase.execute(VALID_INPUT);

    expect(repository.findByExternalReference).toHaveBeenCalledTimes(1);
    expect(repository.findByExternalReference).toHaveBeenCalledWith(
      VALID_INPUT.externalReference,
    );
  });

  // ── 12 ───────────────────────────────────────────────────────────────────────

  it('should call providerGateway.createPayment with exact mapped fields', async () => {
    await useCase.execute(VALID_INPUT);

    expect(providerGateway.createPayment).toHaveBeenCalledWith({
      amount: VALID_INPUT.amount,
      expirationDate: VALID_INPUT.expirationDate,
      description: VALID_INPUT.description,
      externalReference: VALID_INPUT.externalReference,
      redirectUrl: VALID_INPUT.redirectUrl,
      webhookUrl: VALID_INPUT.webhookUrl,
    });
  });

  // ── 13 ───────────────────────────────────────────────────────────────────────

  it('should propagate error and skip update when repository.save throws', async () => {
    repository.save.mockRejectedValue(new Error('DB connection lost'));

    await expect(useCase.execute(VALID_INPUT)).rejects.toThrow(
      'DB connection lost',
    );

    expect(repository.update).not.toHaveBeenCalled();
    expect(providerGateway.createPayment).not.toHaveBeenCalled();
  });

  // ── 14 ───────────────────────────────────────────────────────────────────────

  it('should treat providerPaymentId = 0 as a valid ID (not null)', async () => {
    providerGateway.createPayment.mockResolvedValue({
      ...PROVIDER_RESULT,
      providerPaymentId: 0,
    });

    const output = await useCase.execute(VALID_INPUT);

    expect(output.externalPaymentId).toBe(0);
    expect(output.status).toBe(PaymentStatus.CREATED);
    expect(repository.update).toHaveBeenCalledTimes(1);
  });

  // ── 15 ───────────────────────────────────────────────────────────────────────────

  it('should retry provider for PENDING payment with null externalPaymentId', async () => {
    const pendingPayment = createPendingPaymentFixture({
      externalReference: VALID_INPUT.externalReference,
    });

    repository.findByExternalReference.mockResolvedValue(pendingPayment);

    const output = await useCase.execute(VALID_INPUT);

    // Same local record reused — no duplicate created
    expect(output.id).toBe(pendingPayment.id);
    expect(output.externalPaymentId).toBe(PROVIDER_RESULT.providerPaymentId);
    expect(output.status).toBe(PaymentStatus.CREATED);
    expect(repository.save).not.toHaveBeenCalled();
    expect(repository.update).toHaveBeenCalledTimes(1);
    expect(providerGateway.createPayment).toHaveBeenCalledTimes(1);
  });

  // ── 16 ───────────────────────────────────────────────────────────────────────────

  it('should propagate error and keep payment PENDING when retry also fails', async () => {
    const pendingPayment = createPendingPaymentFixture({
      externalReference: VALID_INPUT.externalReference,
    });

    repository.findByExternalReference.mockResolvedValue(pendingPayment);
    providerGateway.createPayment.mockRejectedValue(
      new HelipagosAuthenticationError(),
    );

    await expect(useCase.execute(VALID_INPUT)).rejects.toBeInstanceOf(
      HelipagosAuthenticationError,
    );
    // No duplicate created and no partial update written
    expect(repository.save).not.toHaveBeenCalled();
    expect(repository.update).not.toHaveBeenCalled();
  });

  // ── 17 ───────────────────────────────────────────────────────────────────────────

  it('should propagate HelipagosAuthenticationError thrown by the provider', async () => {
    providerGateway.createPayment.mockRejectedValue(
      new HelipagosAuthenticationError(),
    );

    await expect(useCase.execute(VALID_INPUT)).rejects.toBeInstanceOf(
      HelipagosAuthenticationError,
    );
    expect(repository.save).toHaveBeenCalledTimes(1);
    expect(repository.update).not.toHaveBeenCalled();
  });

  // ── 18 ───────────────────────────────────────────────────────────────────────────

  it('should propagate HelipagosUnavailableError and keep local payment PENDING', async () => {
    providerGateway.createPayment.mockRejectedValue(
      new HelipagosUnavailableError(),
    );

    await expect(useCase.execute(VALID_INPUT)).rejects.toBeInstanceOf(
      HelipagosUnavailableError,
    );
    expect(repository.save).toHaveBeenCalledTimes(1);
    expect(repository.update).not.toHaveBeenCalled();
  });
});
