module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  globalSetup: './jest.global-setup.ts',
  globalTeardown: './jest.global-teardown.ts',
  setupFiles: ['./jest.setup.ts'],
  testMatch: ['**/tests/**/*.test.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: { module: 'commonjs' } }],
  },
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^@auth/(.*)$': '<rootDir>/auth/src/$1',
    '^@common/(.*)$': '<rootDir>/common/src/$1',
    '^@messaging/(.*)$': '<rootDir>/messaging/src/$1',
    '^@social/(.*)$': '<rootDir>/social/src/$1',
    '^@gateway/(.*)$': '<rootDir>/gateway/src/$1',
    '^@chatognito/crypto$': '<rootDir>/../packages/crypto/src/index.ts',
  },
};
