/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts', '**/*.test.ts'],
  setupFiles: ['<rootDir>/jest.setup.js'],
  testTimeout: 15000,
  clearMocks: true,
};
