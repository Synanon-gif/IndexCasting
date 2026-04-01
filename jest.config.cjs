/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/lib'],
  testMatch: ['**/__tests__/**/*.test.ts', '**/__tests__/**/*.test.tsx'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  clearMocks: true,
  moduleNameMapper: {
    '^react-native$': '<rootDir>/jest/react-native-stub.cjs',
  },
  transform: {
    '^.+\\.(ts|tsx|js|jsx)$': ['ts-jest', { diagnostics: true }],
  },
  transformIgnorePatterns: ['/node_modules/'],
  collectCoverageFrom: [
    'src/services/**/*.ts',
    'lib/**/*.ts',
    '!src/services/__tests__/**',
    '!lib/**/__tests__/**',
  ],
  coverageThreshold: {
    'src/services/realtimeChannelPool.ts': {
      statements: 70,
      branches: 60,
      functions: 70,
      lines: 70,
    },
    'src/services/optionRequestsSupabase.ts': {
      statements: 50,
      branches: 40,
      functions: 50,
      lines: 50,
    },
    'src/services/messengerSupabase.ts': {
      statements: 50,
      branches: 40,
      functions: 50,
      lines: 50,
    },
  },
};
