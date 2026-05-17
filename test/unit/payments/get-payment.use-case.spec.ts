import {
  GetPaymentOutput,
  GetPaymentUseCase,
} from '../../../src/contexts/payments/application/uses-cases/get-payment.use-case';
import { PaymentNotFoundException } from '../../../src/contexts/payments/domain/exceptions/payment-not-found-exception';
import { PaymentDetails } from '../../../src/contexts/payments/domain/gateways/payment-provider.gateway';
import {
  createCreatedPaymentFixture,
  createPendingPaymentFixture,
} from '../../fixtures/payments/payment.fixture';
import { createMockProviderGateway } from '../../mocks/helipagos-http.client.mock';
import { createMockPaymentRepository } from '../../mocks/payment-repository.mock';

// ─── Shared test data ─────────────────────────────────────────────────────────

const PROVIDER_DETAILS: PaymentDetails = {
  providerPaymentId: 987654,
  externalReference: 'order-test-001',
  status: 'PROCESADA',
  amount: 150000,
  paidAmount: 150000,
  paymentMethod: 'credit_card',
  checkoutUrl: 'https://checkout.helipagos.com/pay/987654',
  expirationDate: '2026-12-31',
  paymentDate: '2026-05-15T12:00:00.000Z',
  creditedAt: null,
  createdAt: '2026-05-15T10:00:00.000Z',
  updatedAt: '2026-05-15T12:00:00.000Z',
};

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('GetPaymentUseCase', () => {
  let useCase: GetPaymentUseCase;
  let repository: ReturnType<typeof createMockPaymentRepository>;
  let providerGateway: ReturnType<typeof createMockProviderGateway>;

  beforeEach(() => {
    repository = createMockPaymentRepository();
    providerGateway = createMockProviderGateway();
    useCase = new GetPaymentUseCase(repository, providerGateway);
  });

  // ── 1 ─────────────────────────────────────────────────────────────────────

  it('should return payment with live status from provider when externalPaymentId exists', async () => {
    const payment = createCreatedPaymentFixture();
    repository.findById.mockResolvedValue(payment);
    providerGateway.getPayment.mockResolvedValue(PROVIDER_DETAILS);

    const output = await useCase.execute(payment.id);

    expect(output.status).toBe(PROVIDER_DETAILS.status);
    expect(providerGateway.getPayment).toHaveBeenCalledWith(
      payment.externalPaymentId,
    );
  });

  // ── 2 ─────────────────────────────────────────────────────────────────────

  it('should return payment with local status when externalPaymentId is null (PENDING)', async () => {
    const payment = createPendingPaymentFixture();
    repository.findById.mockResolvedValue(payment);

    const output = await useCase.execute(payment.id);

    expect(output.status).toBe(payment.status);
    expect(output.externalPaymentId).toBeNull();
  });

  // ── 3 ─────────────────────────────────────────────────────────────────────

  it('should NOT call provider when payment is in PENDING state', async () => {
    const payment = createPendingPaymentFixture();
    repository.findById.mockResolvedValue(payment);

    await useCase.execute(payment.id);

    expect(providerGateway.getPayment).not.toHaveBeenCalled();
  });

  // ── 4 ─────────────────────────────────────────────────────────────────────

  it('should throw PaymentNotFoundException when payment is not found', async () => {
    const missingId = 'non-existent-uuid';
    repository.findById.mockResolvedValue(null);

    await expect(useCase.execute(missingId)).rejects.toThrow(
      PaymentNotFoundException,
    );
    await expect(useCase.execute(missingId)).rejects.toThrow(
      `Payment with id '${missingId}' not found`,
    );
  });

  // ── 5 ─────────────────────────────────────────────────────────────────────

  it('should return checkoutUrl from provider (not local) when externalPaymentId exists', async () => {
    const payment = createCreatedPaymentFixture({
      checkoutUrl: 'https://old-local-url.example.com',
    });
    repository.findById.mockResolvedValue(payment);
    providerGateway.getPayment.mockResolvedValue({
      ...PROVIDER_DETAILS,
      checkoutUrl: 'https://checkout.helipagos.com/pay/987654',
    });

    const output: GetPaymentOutput = await useCase.execute(payment.id);

    expect(output.checkoutUrl).toBe(
      'https://checkout.helipagos.com/pay/987654',
    );
    expect(output.checkoutUrl).not.toBe(payment.checkoutUrl);
  });

  // ── 6 ─────────────────────────────────────────────────────────────────────

  it('should NOT update local status in the DB after fetching from provider', async () => {
    const payment = createCreatedPaymentFixture();
    repository.findById.mockResolvedValue(payment);
    providerGateway.getPayment.mockResolvedValue(PROVIDER_DETAILS);

    await useCase.execute(payment.id);

    expect(repository.update).not.toHaveBeenCalled();
    expect(repository.save).not.toHaveBeenCalled();
  });
});
