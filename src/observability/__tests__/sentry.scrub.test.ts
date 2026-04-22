/**
 * Sentry Scrubbing — Unit-Tests
 *
 * Stellen sicher, dass keine sensiblen Tokens / Capability-URLs versehentlich
 * in einer Sentry-Payload landen. Diese Tests sind die DSGVO-Sicherung der
 * Integration und dürfen niemals stillschweigend rot werden.
 */

jest.mock('@sentry/react-native', () => ({
  init: jest.fn(),
  captureException: jest.fn(),
  captureMessage: jest.fn(),
  addBreadcrumb: jest.fn(),
  setTag: jest.fn(),
  setUser: jest.fn(),
}));

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: {} } },
}));

import { redactUrl } from '../sentry';

describe('redactUrl()', () => {
  it('maskt model_invite token in claim url', () => {
    const url = 'https://index-casting.com/?model_invite=abc123def456ghi789jklm';
    expect(redactUrl(url)).toBe('https://index-casting.com/?model_invite=%5BREDACTED%5D');
  });

  it('maskt invite_token in invite url', () => {
    const url = 'https://example.com/?invite_token=foo-bar-baz-secret';
    const out = redactUrl(url);
    expect(out).toContain('invite_token=%5BREDACTED%5D');
    expect(out).not.toContain('foo-bar-baz-secret');
  });

  it('maskt package capability URLs als Query-Param', () => {
    const url =
      'https://index-casting.com/agency?package_url=https%3A%2F%2Fmediaslide.example%2Fcapability%2Fxyz123';
    const out = redactUrl(url);
    expect(out).toContain('package_url=%5BREDACTED%5D');
    expect(out).not.toContain('mediaslide.example');
    expect(out).not.toContain('xyz123');
  });

  it('maskt access_token / refresh_token (Supabase Session)', () => {
    const url = 'https://x.com/?access_token=eyJhbc.def.ghi&refresh_token=longsecret123';
    const out = redactUrl(url);
    expect(out).toContain('access_token=%5BREDACTED%5D');
    expect(out).toContain('refresh_token=%5BREDACTED%5D');
  });

  it('läßt unkritische Query-Parameter durch', () => {
    const url = 'https://index-casting.com/?screen=agency&tab=models';
    expect(redactUrl(url)).toBe('https://index-casting.com/?screen=agency&tab=models');
  });

  it('redaktiert eingebettete JWTs auch im Pfad', () => {
    const url =
      'https://supabase.example/auth/v1/verify/eyJhbcdefghijklmnopq.eyJabcdefghijklmnop.signaturesignaturesignature';
    const out = redactUrl(url);
    expect(out).toContain('[REDACTED_JWT]');
  });

  it('handelt invalide URLs robust', () => {
    expect(redactUrl('not-a-url')).toBe('not-a-url');
    expect(redactUrl('')).toBe('');
  });

  it('redaktiert E-Mail in Pfad', () => {
    const url = 'https://x.com/users/test@example.com/profile';
    const out = redactUrl(url);
    expect(out).not.toContain('test@example.com');
    expect(out).toContain('[REDACTED_EMAIL]');
  });
});
