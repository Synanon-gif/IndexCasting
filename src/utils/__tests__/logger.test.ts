/**
 * Logger tests — PII redaction, console mirror, throttling.
 *
 * We do NOT test the actual RPC ship here (that's a network call); we mock
 * `supabase.rpc` and assert it gets the redacted, throttled payload we expect.
 */

import { redactString, redactValue, __resetLoggerDedupeForTests } from '../logger';

// Mock the supabase client BEFORE importing logger so the rpc spy is in place.
const rpcMock = jest.fn().mockReturnValue(Promise.resolve({ error: null }));
jest.mock('../../../lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
  },
}));

// Re-import logger AFTER the mock is registered.
const { logger } = require('../logger') as typeof import('../logger');

describe('redactString', () => {
  test('redacts emails', () => {
    expect(redactString('user ruben@example.com signed in')).toBe(
      'user [REDACTED_EMAIL] signed in',
    );
  });

  test('redacts JWT-shaped tokens', () => {
    const jwt = 'eyJabcdefghij.eyJabcdefghij.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
    expect(redactString(`token=${jwt}`)).toContain('[REDACTED_JWT]');
  });

  test('redacts Bearer tokens', () => {
    expect(redactString('Authorization: Bearer abcdefghijklmnopqrstuvwxyz123')).toContain(
      'Bearer [REDACTED]',
    );
  });

  test('redacts long hex strings (likely UUIDs/hashes)', () => {
    expect(redactString('hash=' + 'a'.repeat(40))).toContain('[REDACTED_HEX]');
  });

  test('leaves short normal text alone', () => {
    expect(redactString('user clicked button A')).toBe('user clicked button A');
  });
});

describe('redactValue', () => {
  test('drops obvious secret keys entirely', () => {
    const out = redactValue({
      ok: true,
      password: 'hunter2',
      access_token: 'tok',
      api_key: 'k',
      service_role: 'r',
    }) as Record<string, unknown>;
    expect(out.ok).toBe(true);
    expect(out.password).toBe('[REDACTED]');
    expect(out.access_token).toBe('[REDACTED]');
    expect(out.api_key).toBe('[REDACTED]');
    expect(out.service_role).toBe('[REDACTED]');
  });

  test('redacts email values inside nested objects', () => {
    const out = redactValue({
      profile: { email: 'foo@bar.com', name: 'Foo' },
    }) as { profile: { email: string; name: string } };
    expect(out.profile.email).toBe('[REDACTED_EMAIL]');
    expect(out.profile.name).toBe('Foo');
  });

  test('handles arrays', () => {
    const out = redactValue(['ok', 'foo@bar.com']) as string[];
    expect(out[0]).toBe('ok');
    expect(out[1]).toBe('[REDACTED_EMAIL]');
  });

  test('handles cyclic refs without infinite loop', () => {
    const a: Record<string, unknown> = { name: 'a' };
    a.self = a;
    const out = redactValue(a) as Record<string, unknown>;
    expect(out.name).toBe('a');
    expect(out.self).toBe('[Circular]');
  });
});

describe('logger — ship behaviour', () => {
  beforeEach(() => {
    rpcMock.mockClear();
    __resetLoggerDedupeForTests();
  });

  test('debug/info do NOT ship by default', () => {
    logger.debug('test', 'low-priority debug');
    logger.info('test', 'low-priority info');
    expect(rpcMock).not.toHaveBeenCalled();
  });

  test('warn/error/fatal ship to backend by default', () => {
    logger.warn('test', 'warning here');
    logger.error('test', 'something broke');
    logger.fatal('test', 'totally broken');
    expect(rpcMock).toHaveBeenCalledTimes(3);
    // The DB enforces `source IN ('frontend','edge','db','cron','system')`. The
    // caller-supplied logical source (here `'test'`) is mapped to the
    // NOT NULL `p_event` column instead. `p_source` MUST be the platform-layer
    // enum value `'frontend'`.
    expect(rpcMock).toHaveBeenNthCalledWith(
      1,
      'record_system_event',
      expect.objectContaining({
        p_level: 'warn',
        p_source: 'frontend',
        p_event: 'test',
      }),
    );
  });

  test('opts.ship=true forces shipping for low-level logs', () => {
    logger.info('test', 'important info', undefined, { ship: true });
    expect(rpcMock).toHaveBeenCalledTimes(1);
  });

  test('throttles identical events within window', () => {
    logger.error('throttle', 'same message');
    logger.error('throttle', 'same message');
    logger.error('throttle', 'same message');
    expect(rpcMock).toHaveBeenCalledTimes(1);
  });

  test('different messages from same source are not throttled together', () => {
    logger.error('multi', 'message A');
    logger.error('multi', 'message B');
    expect(rpcMock).toHaveBeenCalledTimes(2);
  });

  test('redacts PII in shipped context', () => {
    logger.error('pii', 'user action failed', {
      email: 'leak@example.com',
      password: 'secret123',
      token: 'eyJabcdefghij.eyJabcdefghij.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
    });
    expect(rpcMock).toHaveBeenCalledTimes(1);
    const args = rpcMock.mock.calls[0]![1] as { p_context: Record<string, unknown> };
    expect(args.p_context.email).toBe('[REDACTED_EMAIL]');
    expect(args.p_context.password).toBe('[REDACTED]');
    expect(args.p_context.token).toContain('[REDACTED_JWT]');
  });

  test('redacts PII in message itself', () => {
    logger.error('pii-msg', 'failed for ruben@example.com');
    const args = rpcMock.mock.calls[0]![1] as { p_message: string };
    expect(args.p_message).toBe('failed for [REDACTED_EMAIL]');
  });

  test('passes orgId/userId hints', () => {
    logger.error('hints', 'oops', undefined, { orgId: 'org-123', userId: 'user-456' });
    const args = rpcMock.mock.calls[0]![1] as { p_context: Record<string, unknown> };
    expect(args.p_context._org_id).toBe('org-123');
    expect(args.p_context._user_id).toBe('user-456');
  });
});
