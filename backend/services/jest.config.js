module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  globalSetup: './jest.global-setup.ts',
  setupFiles: ['./jest.setup.ts'],
  testMatch: ['**/tests/**/*.test.ts'],
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  moduleNameMapper: {
    '^@auth/(.*)$': '<rootDir>/auth/src/$1',
    '^@common/(.*)$': '<rootDir>/common/src/$1',
  },
};
