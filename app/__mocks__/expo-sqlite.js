// Mock expo-sqlite for Jest tests
const mockDatabase = {
  run: jest.fn(),
  exec: jest.fn(),
  getFirstAsync: jest.fn(),
  getAllAsync: jest.fn(),
  closeAsync: jest.fn(),
  withTransactionAsync: jest.fn(),
};

module.exports = {
  openDatabaseSync: jest.fn(() => mockDatabase),
  openDatabaseAsync: jest.fn(() => Promise.resolve(mockDatabase)),
};
