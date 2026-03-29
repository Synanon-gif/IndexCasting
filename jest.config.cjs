/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  clearMocks: true,
  moduleNameMapper: {
    '^react-native$': '<rootDir>/jest/react-native-stub.cjs',
  },
  transform: {
    '^.+\\.(ts|tsx|js|jsx)$': ['ts-jest', { diagnostics: false }],
  },
  transformIgnorePatterns: ['/node_modules/'],
};
