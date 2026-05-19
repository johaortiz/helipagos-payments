export function createMockPaymentRepository() {
  return {
    save: jest.fn().mockResolvedValue(undefined),
    update: jest.fn().mockResolvedValue(undefined),
    findById: jest.fn().mockResolvedValue(null),
    findByIdForUpdate: jest.fn().mockResolvedValue(null),
    findByExternalReference: jest.fn().mockResolvedValue(null),
    findByExternalPaymentId: jest.fn().mockResolvedValue(null),
    existsByExternalReference: jest.fn().mockResolvedValue(false),
    findByExternalPaymentIdForUpdate: jest.fn().mockResolvedValue(null),
    processByExternalPaymentIdForUpdate: jest.fn().mockResolvedValue(null),
  };
}
