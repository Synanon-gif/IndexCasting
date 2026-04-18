// @ts-check
const tsParser = require('@typescript-eslint/parser');
const tsPlugin = require('@typescript-eslint/eslint-plugin');
const reactPlugin = require('eslint-plugin-react');
const reactHooksPlugin = require('eslint-plugin-react-hooks');

/** @type {import('eslint').Linter.Config[]} */
module.exports = [
  // Global ignores
  {
    ignores: [
      'node_modules/**',
      '.expo/**',
      'dist/**',
      'ios/**',
      'android/**',
      'web-build/**',
      '*.config.js',
      '*.config.cjs',
      'jest.config.cjs',
      'eslint.config.cjs',
      'babel.config.js',
      'supabase/**',
    ],
  },
  // TypeScript + React source files
  {
    files: ['src/**/*.{ts,tsx}', 'lib/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
      globals: {
        console: 'readonly',
        window: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        fetch: 'readonly',
        URL: 'readonly',
        Promise: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        __DEV__: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        global: 'readonly',
        module: 'readonly',
        require: 'readonly',
        exports: 'readonly',
        localStorage: 'readonly',
        HTMLInputElement: 'readonly',
        File: 'readonly',
        Blob: 'readonly',
        FormData: 'readonly',
        ArrayBuffer: 'readonly',
        Uint8Array: 'readonly',
        TextDecoder: 'readonly',
        TextEncoder: 'readonly',
        crypto: 'readonly',
        atob: 'readonly',
        btoa: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      'react': reactPlugin,
      'react-hooks': reactHooksPlugin,
    },
    settings: {
      react: { version: 'detect' },
    },
    rules: {
      // TypeScript
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
      }],
      '@typescript-eslint/no-require-imports': 'warn',

      // React
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',

      // React Hooks
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',

      // General
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },
  // Test files: Jest patterns require dynamic require() and any in mock typings.
  // Production rules remain strict; these overrides apply ONLY to *.test.ts(x)
  // and files inside any __tests__ folder.
  {
    files: [
      'src/**/__tests__/**/*.{ts,tsx}',
      'src/**/*.test.{ts,tsx}',
      'lib/**/__tests__/**/*.{ts,tsx}',
      'lib/**/*.test.{ts,tsx}',
    ],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
];
