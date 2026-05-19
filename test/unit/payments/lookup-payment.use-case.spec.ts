import { LookupPaymentUseCase } from '../../../src/contexts/payments/application/uses-cases/lookup-payment.use-case';
import { PaymentNotFoundException } from '../../../src/contexts/payments/domain/exceptions/payment-not-found-exception';
import {
  createCreatedPaymentFixture,
  createPendingPaymentFixture,
} from '../../fixtures/payments/payment.fixture';
import { createMockPaymentRepository } from '../../mocks/payment-repository.mock';

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('LookupPaymentUseCase', () => {
  let useCase: LookupPaymentUseCase;
  let repository: ReturnType<typeof createMockPaymentRepository>;

  beforeEach(() => {
    repository = createMockPaymentRepository();
    useCase = new LookupPaymentUseCase(repository);
  });

  // ── 1 ─────────────────────────────────────────────────────────────────────

  it('should return payment when found by externalReference', async () => {
    const payment = createPendingPaymentFixture();
    repository.findByExternalReference.mockResolvedValue(payment);

    const output = await useCase.execute({
      externalReference: payment.externalReference,
    });

    expect(output.id).toBe(payment.id);
    expect(output.externalReference).toBe(payment.externalReference);
    expect(output.status).toBe(payment.status);
    expect(repository.findByExternalReference).toHaveBeenCalledWith(
      payment.externalReference,
    );
    expect(repository.findByExternalPaymentId).not.toHaveBeenCalled();
  });

  // ── 2 ─────────────────────────────────────────────────────────────────────

  it('should return payment when found by externalPaymentId', async () => {
    const payment = createCreatedPaymentFixture();
    repository.findByExternalPaymentId.mockResolvedValue(payment);

    const output = await useCase.execute({
      externalPaymentId: payment.externalPaymentId!,
    });

    expect(output.id).toBe(payment.id);
    expect(output.externalPaymentId).toBe(payment.externalPaymentId);
    expect(repository.findByExternalPaymentId).toHaveBeenCalledWith(
      payment.externalPaymentId,
    );
    expect(repository.findByExternalReference).not.toHaveBeenCalled();
  });

  // ── 3 ─────────────────────────────────────────────────────────────────────

  it('should prefer externalReference over externalPaymentId when both are provided', async () => {
    const payment = createCreatedPaymentFixture();
    repository.findByExternalReference.mockResolvedValue(payment);

    const output = await useCase.execute({
      externalReference: payment.externalReference,
      externalPaymentId: payment.externalPaymentId!,
    });

    expect(output.externalReference).toBe(payment.externalReference);
    expect(repository.findByExternalReference).toHaveBeenCalledWith(
      payment.externalReference,
    );
    expect(repository.findByExternalPaymentId).not.toHaveBeenCalled();
  });

  // ── 4 ─────────────────────────────────────────────────────────────────────

  it('should throw PaymentNotFoundException when not found by externalReference', async () => {
    repository.findByExternalReference.mockResolvedValue(null);

    await expect(
      useCase.execute({ externalReference: 'unknown-ref' }),
    ).rejects.toThrow(PaymentNotFoundException);
  });

  // ── 5 ─────────────────────────────────────────────────────────────────────

  it('should throw PaymentNotFoundException when not found by externalPaymentId', async () => {
    repository.findByExternalPaymentId.mockResolvedValue(null);

    await expect(useCase.execute({ externalPaymentId: 99999 })).rejects.toThrow(
      PaymentNotFoundException,
    );
  });

  // ── 6 ─────────────────────────────────────────────────────────────────────

  it('should include shortUrl and barCode from the domain entity in the output', async () => {
    const payment = createCreatedPaymentFixture({
      shortUrl: 'https://hpg.ar/xyz',
      barCode: '9876543210',
    });
    repository.findByExternalReference.mockResolvedValue(payment);

    const output = await useCase.execute({
      externalReference: payment.externalReference,
    });

    expect(output.shortUrl).toBe('https://hpg.ar/xyz');
    expect(output.barCode).toBe('9876543210');
    expect(output.checkoutUrl).toBe(payment.checkoutUrl);
  });
});
