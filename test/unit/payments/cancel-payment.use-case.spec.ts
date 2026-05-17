import { CancelPaymentUseCase } from '../../../src/contexts/payments/application/uses-cases/cancel-payment.use-case';
import { PaymentDomainError } from '../../../src/contexts/payments/domain/entities/payment.entity';
import { PaymentStatus } from '../../../src/contexts/payments/domain/enums/payment-status.enum';
import { PaymentNotFoundException } from '../../../src/contexts/payments/domain/exceptions/payment-not-found-exception';
import {
  createCreatedPaymentFixture,
  createPendingPaymentFixture,
  createProcessedPaymentFixture,
} from '../../fixtures/payments/payment.fixture';
import { createMockProviderGateway } from '../../mocks/helipagos-http.client.mock';
import { createMockPaymentRepository } from '../../mocks/payment-repository.mock';

describe('CancelPaymentUseCase', () => {
  let useCase: CancelPaymentUseCase;
  let repository: ReturnType<typeof createMockPaymentRepository>;
  let providerGateway: ReturnType<typeof createMockProviderGateway>;

  beforeEach(() => {
    repository = createMockPaymentRepository();
    providerGateway = createMockProviderGateway();
    useCase = new CancelPaymentUseCase(repository, providerGateway);

    providerGateway.cancelPayment.mockResolvedValue({
      success: true,
      message: 'Payment cancelled.',
    });
  });

  // ── 1 ─────────────────────────────────────────────────────────────────────

  it('should cancel payment successfully and update repository', async () => {
    const payment = createPendingPaymentFixture();
    repository.findById.mockResolvedValue(payment);

    await useCase.execute(payment.id);

    expect(payment.status).toBe(PaymentStatus.CANCELLED);
    expect(repository.update).toHaveBeenCalledTimes(1);
  });

  // ── 2 ─────────────────────────────────────────────────────────────────────

  it('should call providerGateway.cancelPayment when externalPaymentId exists', async () => {
    const payment = createCreatedPaymentFixture();
    repository.findById.mockResolvedValue(payment);

    await useCase.execute(payment.id);

    expect(providerGateway.cancelPayment).toHaveBeenCalledTimes(1);
    expect(providerGateway.cancelPayment).toHaveBeenCalledWith(
      payment.externalPaymentId,
    );
  });

  // ── 3 ─────────────────────────────────────────────────────────────────────

  it('should NOT call providerGateway.cancelPayment when payment is in PENDING state', async () => {
    const payment = createPendingPaymentFixture();
    repository.findById.mockResolvedValue(payment);

    await useCase.execute(payment.id);

    expect(providerGateway.cancelPayment).not.toHaveBeenCalled();
  });

  // ── 4 ─────────────────────────────────────────────────────────────────────

  it('should throw PaymentNotFoundException when payment does not exist', async () => {
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

  it('should propagate PaymentDomainError when cancelling a PROCESSED payment', async () => {
    const payment = createProcessedPaymentFixture();
    repository.findById.mockResolvedValue(payment);

    await expect(useCase.execute(payment.id)).rejects.toThrow(
      PaymentDomainError,
    );
    await expect(useCase.execute(payment.id)).rejects.toThrow(
      `Cannot cancel a payment with status: ${PaymentStatus.PROCESSED}`,
    );

    expect(repository.update).not.toHaveBeenCalled();
  });

  // ── 6 ─────────────────────────────────────────────────────────────────────

  it('should call repository.update after successful cancellation', async () => {
    const payment = createCreatedPaymentFixture();
    repository.findById.mockResolvedValue(payment);

    await useCase.execute(payment.id);

    expect(repository.update).toHaveBeenCalledTimes(1);
    expect(repository.update).toHaveBeenCalledWith(payment);
  });
});
