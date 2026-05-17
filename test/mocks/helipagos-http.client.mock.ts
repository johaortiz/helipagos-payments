export function createMockProviderGateway() {
  return {
    createPayment: jest.fn().mockResolvedValue(null),
    getPayment: jest.fn().mockResolvedValue(null),
    cancelPayment: jest.fn().mockResolvedValue(null),
  };
}
