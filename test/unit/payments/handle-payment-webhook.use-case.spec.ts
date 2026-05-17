import { PaymentWebhookInput } from '../../../src/contexts/payments/application/dto/payment-webhook.input';
import { HandlePaymentWebhookUseCase } from '../../../src/contexts/payments/application/uses-cases/handle-payment-webhook.use-case';
import { Payment } from '../../../src/contexts/payments/domain/entities/payment.entity';
import { PaymentStatus } from '../../../src/contexts/payments/domain/enums/payment-status.enum';
import {
  createCreatedPaymentFixture,
  createProcessedPaymentFixture,
} from '../../fixtures/payments/payment.fixture';
import { createMockPaymentRepository } from '../../mocks/payment-repository.mock';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildInput(
  id_sp: number,
  estado: string,
  extra?: Partial<PaymentWebhookInput>,
): PaymentWebhookInput {
  return { id_sp, estado, referencia_externa: 'order-test-001', ...extra };
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('HandlePaymentWebhookUseCase', () => {
  let useCase: HandlePaymentWebhookUseCase;
  let repository: ReturnType<typeof createMockPaymentRepository>;

  beforeEach(() => {
    repository = createMockPaymentRepository();
    useCase = new HandlePaymentWebhookUseCase(repository);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ── 1 — PROCESADA ─────────────────────────────────────────────────────────

  it('should update payment status to PROCESSED when estado is PROCESADA', async () => {
    const payment = createCreatedPaymentFixture();
    repository.findByExternalPaymentIdForUpdate.mockResolvedValue(payment);

    await useCase.execute(buildInput(987654, 'PROCESADA'));

    const updated = (repository.update.mock.calls[0] as [Payment])[0];
    expect(updated.status).toBe(PaymentStatus.PROCESSED);
    expect(repository.update).toHaveBeenCalledTimes(1);
  });

  // ── 2 — ACREDITADA ────────────────────────────────────────────────────────

  it('should update payment status to ACCREDITED when estado is ACREDITADA', async () => {
    const payment = createProcessedPaymentFixture();
    repository.findByExternalPaymentIdForUpdate.mockResolvedValue(payment);

    await useCase.execute(buildInput(987654, 'ACREDITADA'));

    const updated = (repository.update.mock.calls[0] as [Payment])[0];
    expect(updated.status).toBe(PaymentStatus.ACCREDITED);
    expect(repository.update).toHaveBeenCalledTimes(1);
  });

  // ── 3 — VENCIDA ───────────────────────────────────────────────────────────

  it('should update payment status to EXPIRED when estado is VENCIDA', async () => {
    const payment = createCreatedPaymentFixture();
    repository.findByExternalPaymentIdForUpdate.mockResolvedValue(payment);

    await useCase.execute(buildInput(987654, 'VENCIDA'));

    const updated = (repository.update.mock.calls[0] as [Payment])[0];
    expect(updated.status).toBe(PaymentStatus.EXPIRED);
  });

  // ── 4 — ANULADA ───────────────────────────────────────────────────────────

  it('should update payment status to REJECTED when estado is ANULADA', async () => {
    const payment = createCreatedPaymentFixture();
    repository.findByExternalPaymentIdForUpdate.mockResolvedValue(payment);

    await useCase.execute(buildInput(987654, 'ANULADA'));

    const updated = (repository.update.mock.calls[0] as [Payment])[0];
    expect(updated.status).toBe(PaymentStatus.REJECTED);
  });

  // ── 5 — RECHAZADA ─────────────────────────────────────────────────────────

  it('should update payment status to REJECTED when estado is RECHAZADA', async () => {
    const payment = createCreatedPaymentFixture();
    repository.findByExternalPaymentIdForUpdate.mockResolvedValue(payment);

    await useCase.execute(buildInput(987654, 'RECHAZADA'));

    const updated = (repository.update.mock.calls[0] as [Payment])[0];
    expect(updated.status).toBe(PaymentStatus.REJECTED);
  });

  // ── 6 — DEVUELTA ─────────────────────────────────────────────────────────

  it('should update payment status to CHARGEBACK when estado is DEVUELTA', async () => {
    const payment = createProcessedPaymentFixture();
    repository.findByExternalPaymentIdForUpdate.mockResolvedValue(payment);

    await useCase.execute(buildInput(987654, 'DEVUELTA'));

    const updated = (repository.update.mock.calls[0] as [Payment])[0];
    expect(updated.status).toBe(PaymentStatus.CHARGEBACK);
  });

  // ── 7 — CONTRACARGO ──────────────────────────────────────────────────────

  it('should update payment status to CHARGEBACK when estado is CONTRACARGO', async () => {
    const payment = createProcessedPaymentFixture();
    repository.findByExternalPaymentIdForUpdate.mockResolvedValue(payment);

    await useCase.execute(buildInput(987654, 'CONTRACARGO'));

    const updated = (repository.update.mock.calls[0] as [Payment])[0];
    expect(updated.status).toBe(PaymentStatus.CHARGEBACK);
  });

  // ── 8 — payment not found ────────────────────────────────────────────────

  it('should return void and NOT throw when id_sp is unknown', async () => {
    repository.findByExternalPaymentIdForUpdate.mockResolvedValue(null);

    await expect(
      useCase.execute(buildInput(999999, 'PROCESADA')),
    ).resolves.toBeUndefined();
  });

  // ── 9 — unknown estado ───────────────────────────────────────────────────

  it('should return void and NOT throw when estado is unknown', async () => {
    const payment = createCreatedPaymentFixture();
    repository.findByExternalPaymentIdForUpdate.mockResolvedValue(payment);

    await expect(
      useCase.execute(buildInput(987654, 'ESTADO_DESCONOCIDO')),
    ).resolves.toBeUndefined();
  });

  // ── 10 — domain transition throws ────────────────────────────────────────

  it('should return void and NOT throw when domain transition throws', async () => {
    // EXPIRED is terminal — markAsProcessed will throw PaymentDomainError
    const terminalPayment = createCreatedPaymentFixture({
      status: PaymentStatus.EXPIRED,
    });
    repository.findByExternalPaymentIdForUpdate.mockResolvedValue(
      terminalPayment,
    );

    await expect(
      useCase.execute(buildInput(987654, 'PROCESADA')),
    ).resolves.toBeUndefined();
  });

  // ── 11 — locking contract ────────────────────────────────────────────────

  it('should call findByExternalPaymentIdForUpdate (not findByExternalPaymentId)', async () => {
    repository.findByExternalPaymentIdForUpdate.mockResolvedValue(null);

    await useCase.execute(buildInput(987654, 'PROCESADA'));

    expect(repository.findByExternalPaymentIdForUpdate).toHaveBeenCalledWith(
      987654,
    );
    expect(repository.findByExternalPaymentId).not.toHaveBeenCalled();
  });

  // ── 12 — update called after successful transition ────────────────────────

  it('should call repository.update after a successful transition', async () => {
    const payment = createCreatedPaymentFixture();
    repository.findByExternalPaymentIdForUpdate.mockResolvedValue(payment);

    await useCase.execute(buildInput(987654, 'PROCESADA'));

    expect(repository.update).toHaveBeenCalledTimes(1);
    expect(repository.update).toHaveBeenCalledWith(payment);
  });

  // ── 13 — no update when payment not found ────────────────────────────────

  it('should NOT call repository.update when payment is not found', async () => {
    repository.findByExternalPaymentIdForUpdate.mockResolvedValue(null);

    await useCase.execute(buildInput(999999, 'PROCESADA'));

    expect(repository.update).not.toHaveBeenCalled();
  });

  // ── 14 — no update when estado is unknown ────────────────────────────────

  it('should NOT call repository.update when estado is unknown', async () => {
    const payment = createCreatedPaymentFixture();
    repository.findByExternalPaymentIdForUpdate.mockResolvedValue(payment);

    await useCase.execute(buildInput(987654, 'ESTADO_DESCONOCIDO'));

    expect(repository.update).not.toHaveBeenCalled();
  });
});
