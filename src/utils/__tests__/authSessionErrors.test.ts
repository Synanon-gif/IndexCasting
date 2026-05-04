import { isSessionNotFoundError } from '../authSessionErrors';

describe('isSessionNotFoundError', () => {
  test('matches message substring', () => {
    expect(isSessionNotFoundError(new Error('session_not_found'))).toBe(true);
  });

  test('matches code field', () => {
    expect(isSessionNotFoundError({ code: 'session_not_found', message: 'nope' })).toBe(true);
  });

  test('Supabase-style body (403 + session_not_found text)', () => {
    expect(
      isSessionNotFoundError({
        status: 403,
        message: 'Session not found (session_not_found)',
      }),
    ).toBe(true);
  });

  test('rejects unrelated errors', () => {
    expect(isSessionNotFoundError(new Error('network'))).toBe(false);
    expect(isSessionNotFoundError(null)).toBe(false);
    expect(isSessionNotFoundError({ status: 401, message: 'JWT expired' })).toBe(false);
  });
});
