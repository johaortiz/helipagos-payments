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

type MockRepo = ReturnType<typeof createMockPaymentRepository>;

/**
 * Configures processByExternalPaymentIdForUpdate to act as if the given
 * payment was found: invokes the handler callback and returns the payment.
 */
function mockFoundPayment(repo: MockRepo, payment: Payment): void {
  repo.processByExternalPaymentIdForUpdate.mockImplementation(
    async (
      _id: number,
      handler: (p: Payment) => boolean | Promise<boolean>,
    ) => {
      await handler(payment);
      return payment;
    },
  );
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('HandlePaymentWebhookUseCase', () => {
  let useCase: HandlePaymentWebhookUseCase;
  let repository: MockRepo;

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
    mockFoundPayment(repository, payment);

    await useCase.execute(buildInput(987654, 'PROCESADA'));

    expect(payment.status).toBe(PaymentStatus.PROCESSED);
    expect(repository.processByExternalPaymentIdForUpdate).toHaveBeenCalledWith(
      987654,
      expect.any(Function),
    );
  });

  // ── 2 — ACREDITADA ────────────────────────────────────────────────────────

  it('should update payment status to ACCREDITED when estado is ACREDITADA', async () => {
    const payment = createProcessedPaymentFixture();
    mockFoundPayment(repository, payment);

    await useCase.execute(buildInput(987654, 'ACREDITADA'));

    expect(payment.status).toBe(PaymentStatus.ACCREDITED);
  });

  // ── 3 — VENCIDA ───────────────────────────────────────────────────────────

  it('should update payment status to EXPIRED when estado is VENCIDA', async () => {
    const payment = createCreatedPaymentFixture();
    mockFoundPayment(repository, payment);

    await useCase.execute(buildInput(987654, 'VENCIDA'));

    expect(payment.status).toBe(PaymentStatus.EXPIRED);
  });

  // ── 4 — ANULADA ───────────────────────────────────────────────────────────

  it('should update payment status to REJECTED when estado is ANULADA', async () => {
    const payment = createCreatedPaymentFixture();
    mockFoundPayment(repository, payment);

    await useCase.execute(buildInput(987654, 'ANULADA'));

    expect(payment.status).toBe(PaymentStatus.REJECTED);
  });

  // ── 5 — RECHAZADA ─────────────────────────────────────────────────────────

  it('should update payment status to REJECTED when estado is RECHAZADA', async () => {
    const payment = createCreatedPaymentFixture();
    mockFoundPayment(repository, payment);

    await useCase.execute(buildInput(987654, 'RECHAZADA'));

    expect(payment.status).toBe(PaymentStatus.REJECTED);
  });

  // ── 6 — DEVUELTA ─────────────────────────────────────────────────────────

  it('should update payment status to CHARGEBACK when estado is DEVUELTA', async () => {
    const payment = createProcessedPaymentFixture();
    mockFoundPayment(repository, payment);

    await useCase.execute(buildInput(987654, 'DEVUELTA'));

    expect(payment.status).toBe(PaymentStatus.CHARGEBACK);
  });

  // ── 7 — CONTRACARGO ──────────────────────────────────────────────────────

  it('should update payment status to CHARGEBACK when estado is CONTRACARGO', async () => {
    const payment = createProcessedPaymentFixture();
    mockFoundPayment(repository, payment);

    await useCase.execute(buildInput(987654, 'CONTRACARGO'));

    expect(payment.status).toBe(PaymentStatus.CHARGEBACK);
  });

  // ── 8 — payment not found ────────────────────────────────────────────────

  it('should return void and NOT throw when id_sp is unknown', async () => {
    // Default mock: processByExternalPaymentIdForUpdate returns null.
    await expect(
      useCase.execute(buildInput(999999, 'PROCESADA')),
    ).resolves.toBeUndefined();

    expect(repository.processByExternalPaymentIdForUpdate).toHaveBeenCalledWith(
      999999,
      expect.any(Function),
    );
  });

  // ── 9 — unknown estado ───────────────────────────────────────────────────

  it('should return void and NOT throw when estado is unknown', async () => {
    const payment = createCreatedPaymentFixture();
    mockFoundPayment(repository, payment);

    await expect(
      useCase.execute(buildInput(987654, 'ESTADO_DESCONOCIDO')),
    ).resolves.toBeUndefined();

    // Domain entity must not have changed status.
    expect(payment.status).toBe(PaymentStatus.CREATED);
  });

  // ── 10 — domain transition throws ────────────────────────────────────────

  it('should return void and NOT throw when domain transition throws', async () => {
    // EXPIRED is terminal — markAsProcessed will throw PaymentDomainError.
    const terminalPayment = createCreatedPaymentFixture({
      status: PaymentStatus.EXPIRED,
    });
    mockFoundPayment(repository, terminalPayment);

    await expect(
      useCase.execute(buildInput(987654, 'PROCESADA')),
    ).resolves.toBeUndefined();
  });

  // ── 11 — locking contract ────────────────────────────────────────────────

  it('should call processByExternalPaymentIdForUpdate — not the bare find or update methods', async () => {
    // Default mock: returns null (payment not found).
    await useCase.execute(buildInput(987654, 'PROCESADA'));

    expect(repository.processByExternalPaymentIdForUpdate).toHaveBeenCalledWith(
      987654,
      expect.any(Function),
    );
    expect(repository.findByExternalPaymentId).not.toHaveBeenCalled();
    expect(repository.findByExternalPaymentIdForUpdate).not.toHaveBeenCalled();
  });

  // ── 12 — persistence delegated to transactional method ───────────────────

  it('should NOT call repository.update directly; persistence is handled inside processByExternalPaymentIdForUpdate', async () => {
    const payment = createCreatedPaymentFixture();
    mockFoundPayment(repository, payment);

    await useCase.execute(buildInput(987654, 'PROCESADA'));

    expect(repository.update).not.toHaveBeenCalled();
    // Domain entity was mutated by the handler inside the transaction.
    expect(payment.status).toBe(PaymentStatus.PROCESSED);
  });

  // ── 13 — no update when payment not found ────────────────────────────────

  it('should NOT call repository.update when payment is not found', async () => {
    // Default mock: processByExternalPaymentIdForUpdate returns null.
    await useCase.execute(buildInput(999999, 'PROCESADA'));

    expect(repository.update).not.toHaveBeenCalled();
  });

  // ── 14 — no update when estado is unknown ────────────────────────────────

  it('should NOT call repository.update when estado is unknown', async () => {
    const payment = createCreatedPaymentFixture();
    mockFoundPayment(repository, payment);

    await useCase.execute(buildInput(987654, 'ESTADO_DESCONOCIDO'));

    expect(repository.update).not.toHaveBeenCalled();
  });
});
