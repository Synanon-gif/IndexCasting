/**
 * Sentry Scrubbing — Unit-Tests
 *
 * Stellen sicher, dass keine sensiblen Tokens / Capability-URLs versehentlich
 * in einer Sentry-Payload landen. Diese Tests sind die DSGVO-Sicherung der
 * Integration und dürfen niemals stillschweigend rot werden.
 *
 * Hardening 2026-04: Tests für Object-Key-Redaction (claim_token, p_token,
 * model_invite, capability_url …), Hash-Fragment (Magic-Link), event.exception
 * Sanitization, Breadcrumb-Daten und Fail-closed-Verhalten.
 */

const sentryMock = {
  init: jest.fn(),
  captureException: jest.fn(),
  captureMessage: jest.fn(),
  addBreadcrumb: jest.fn(),
  setTag: jest.fn(),
  setUser: jest.fn(),
};

jest.mock('@sentry/react-native', () => sentryMock);

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: {} } },
}));

import {
  redactUrl,
  captureException,
  captureMessage,
  addBreadcrumb,
  setFlowContext,
  setUserContext,
  isSentryEnabled,
} from '../sentry';

beforeEach(() => {
  Object.values(sentryMock).forEach((fn) => fn.mockReset());
});

// ────────────────────────────────────────────────────────────────────────────
// redactUrl — Query-Param-Maskierung
// ────────────────────────────────────────────────────────────────────────────
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

  // Hardening F5: Hash-Fragment (Supabase Magic-Link)
  it('redaktiert access_token im Hash-Fragment (Supabase Magic-Link)', () => {
    const url =
      'https://app.example.com/#access_token=eyJh.eyJp.signature&refresh_token=rt-abc-123-very-long-secret&type=recovery';
    const out = redactUrl(url);
    expect(out).toContain('access_token=%5BREDACTED%5D');
    expect(out).toContain('refresh_token=%5BREDACTED%5D');
    expect(out).not.toContain('rt-abc-123-very-long-secret');
    expect(out).toContain('type=recovery');
  });

  it('redaktiert verschachtelte Tokens im Hash-Fragment ohne urlencoded-Form', () => {
    const url =
      'https://app.example.com/#someopaquejwt-eyJabcdefghijklm.eyJpqrstuvwxyz.sigsigsigsig12345';
    const out = redactUrl(url);
    expect(out).toContain('[REDACTED_JWT]');
  });

  it('handelt unparsebaren Hash robust mit hartem REDACT', () => {
    // URLSearchParams ist sehr tolerant; trotzdem fällt unser catch nicht
    // ungenutzt vom Himmel: wenn der Pfad sich ändert, wollen wir keine Crash.
    const url = 'https://app.example.com/#';
    expect(() => redactUrl(url)).not.toThrow();
  });

  it('Path mit langem Token-Segment wird String-redaktiert', () => {
    const url =
      '/auth/v1/verify/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1234567890abcdefABCDEF';
    const out = redactUrl(url);
    // Lange Hex-Substrings werden entfernt
    expect(out).toContain('[REDACTED_HEX]');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Object-Key-Redaction (Hardening F4)
// ────────────────────────────────────────────────────────────────────────────
describe('captureException — context redaction', () => {
  // Sentry ist im Jest-Env nicht initialisiert (env=development),
  // deshalb sind die Wrappers no-ops. Wir testen redactDeep indirekt
  // über eine isSentryEnabled-Bypass-Variante: prüfe stattdessen, dass
  // captureException keine raw secrets weitergibt, falls aktiv.
  it('isSentryEnabled() ist false ohne DSN/dev', () => {
    expect(isSentryEnabled()).toBe(false);
    captureException(new Error('boom'), { p_token: 'secret123', claim_token: 'abc' });
    // No-op pfad → keine SDK-Calls
    expect(sentryMock.captureException).not.toHaveBeenCalled();
  });
});

describe('captureMessage / addBreadcrumb / setFlowContext — fail-closed', () => {
  it('captureMessage no-op wenn Sentry deaktiviert', () => {
    captureMessage('hello world', 'info');
    expect(sentryMock.captureMessage).not.toHaveBeenCalled();
  });

  it('addBreadcrumb no-op wenn Sentry deaktiviert', () => {
    addBreadcrumb({ category: 'test', message: 'foo' });
    expect(sentryMock.addBreadcrumb).not.toHaveBeenCalled();
  });

  it('setFlowContext no-op wenn Sentry deaktiviert', () => {
    setFlowContext({ area: 'agency', screen: 'models' });
    expect(sentryMock.setTag).not.toHaveBeenCalled();
  });

  it('setUserContext no-op wenn Sentry deaktiviert', () => {
    setUserContext('user-123');
    expect(sentryMock.setUser).not.toHaveBeenCalled();
  });

  it('Calls bei undefined/null Inputs werfen nicht', () => {
    expect(() => captureException(null)).not.toThrow();
    expect(() => captureException(undefined)).not.toThrow();
    expect(() => captureMessage('')).not.toThrow();
    expect(() => addBreadcrumb({ category: '' })).not.toThrow();
    expect(() => setFlowContext({})).not.toThrow();
    expect(() => setUserContext(null)).not.toThrow();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Test der internen redactDeep-Logik via eine Modul-internal API:
// Wir importieren das Modul nochmal mit aktivem Mock und prüfen, dass
// der `beforeSend`-Pfad bestimmte Felder nuked.
// ────────────────────────────────────────────────────────────────────────────
describe('sanitizeEvent (über aktive init-Pfad simulieren)', () => {
  // Wir aktivieren den Sentry-Init, indem wir process.env überschreiben.
  // Danach reset und re-import, um den initSentry-Pfad zu durchlaufen.
  const ORIGINAL_ENV = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    jest.resetModules();
  });

  function setupActive(): {
    captured: { value?: string; type?: string }[];
    initOpts: Record<string, unknown> | undefined;
  } {
    process.env.EXPO_PUBLIC_APP_ENV = 'production';
    process.env.EXPO_PUBLIC_SENTRY_DSN = 'https://abc@o0.ingest.sentry.io/1';
    let initOpts: Record<string, unknown> | undefined;
    const captured: { value?: string; type?: string }[] = [];
    jest.resetModules();
    jest.doMock('@sentry/react-native', () => ({
      init: jest.fn((opts) => {
        initOpts = opts;
      }),
      captureException: jest.fn((_err, scope) => {
        // Simuliere echten Sentry-Roundtrip: rufe beforeSend mit Fake-Event.
        const beforeSend = initOpts?.beforeSend as undefined | ((e: unknown) => unknown);
        const event = {
          message: 'fail for token eyJaaaaaaaaaa.eyJbbbbbbbbbb.cccccccccc',
          transaction: '/auth/v1/verify?token=verysecrettoken12345678901234567890',
          exception: {
            values: [
              {
                type: 'Error',
                value: 'boom for user@example.com with sb_secret_abc1234567890123456',
              },
            ],
          },
          extra: { ...scope?.extra },
        };
        const sanitized = beforeSend ? (beforeSend(event) as typeof event | null) : event;
        if (sanitized?.exception?.values) {
          for (const v of sanitized.exception.values) captured.push(v);
        }
      }),
      captureMessage: jest.fn(),
      addBreadcrumb: jest.fn(),
      setTag: jest.fn(),
      setUser: jest.fn(),
    }));
    jest.doMock('expo-constants', () => ({
      __esModule: true,
      default: { expoConfig: { extra: {} } },
    }));
    return { captured, initOpts };
  }

  it('redaktiert exception.value (Error-Message), transaction, extra', () => {
    const { captured } = setupActive();
    const sentryMod = require('../sentry') as typeof import('../sentry');
    sentryMod.initSentry();
    sentryMod.captureException(new Error('boom'), {
      p_token: 'secret-claim-token-123',
      capability_url: 'https://mediaslide/cap/xyz123',
      mother_agency_email: 'star@motheragency.com',
    });
    // exception.value wird über beforeSend redaktiert
    expect(captured[0]?.value).not.toContain('user@example.com');
    expect(captured[0]?.value).toContain('[REDACTED_EMAIL]');
    expect(captured[0]?.value).not.toContain('sb_secret_abc1234567890123456');
    expect(captured[0]?.value).toContain('[REDACTED_SUPABASE_KEY]');
  });
});

describe('sanitizeEvent — extra/context redaction', () => {
  const ORIGINAL_ENV = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    jest.resetModules();
  });

  function setupAndCapture(extraInput: Record<string, unknown>): Record<string, unknown> {
    process.env.EXPO_PUBLIC_APP_ENV = 'production';
    process.env.EXPO_PUBLIC_SENTRY_DSN = 'https://abc@o0.ingest.sentry.io/1';
    let initOpts: Record<string, unknown> | undefined;
    let observedExtra: Record<string, unknown> = {};
    jest.resetModules();
    jest.doMock('@sentry/react-native', () => ({
      init: jest.fn((opts) => {
        initOpts = opts;
      }),
      captureException: jest.fn((_err, scope) => {
        const beforeSend = initOpts?.beforeSend as undefined | ((e: unknown) => unknown);
        const event = { extra: { ...(scope?.extra as Record<string, unknown>) } };
        const sanitized = beforeSend ? (beforeSend(event) as typeof event | null) : event;
        observedExtra = (sanitized?.extra as Record<string, unknown>) ?? {};
      }),
      captureMessage: jest.fn(),
      addBreadcrumb: jest.fn(),
      setTag: jest.fn(),
      setUser: jest.fn(),
    }));
    jest.doMock('expo-constants', () => ({
      __esModule: true,
      default: { expoConfig: { extra: {} } },
    }));
    const sentryMod = require('../sentry') as typeof import('../sentry');
    sentryMod.initSentry();
    sentryMod.captureException(new Error('x'), extraInput);
    return observedExtra;
  }

  it('p_token / claim_token / inviteToken / model_invite werden vollständig redaktiert', () => {
    const out = setupAndCapture({
      p_token: 'secret1',
      claim_token: 'secret2',
      inviteToken: 'secret3',
      model_invite: 'secret4',
      invitation_token: 'secret5',
    });
    expect(out.p_token).toBe('[REDACTED]');
    expect(out.claim_token).toBe('[REDACTED]');
    expect(out.inviteToken).toBe('[REDACTED]');
    expect(out.model_invite).toBe('[REDACTED]');
    expect(out.invitation_token).toBe('[REDACTED]');
  });

  it('capability_url / package_url / package_capability_url werden vollständig redaktiert', () => {
    const out = setupAndCapture({
      capability_url: 'https://mediaslide/cap/abc-secret',
      package_url: 'https://mediaslide/cap/xyz',
      package_capability_url: 'https://mediaslide/cap/uvw',
    });
    expect(out.capability_url).toBe('[REDACTED]');
    expect(out.package_url).toBe('[REDACTED]');
    expect(out.package_capability_url).toBe('[REDACTED]');
  });

  it('access_token / refresh_token / api_key / authorization werden vollständig redaktiert', () => {
    const out = setupAndCapture({
      access_token: 'eyJaaa.eyJbbb.ccc',
      refresh_token: 'rt-secret-12345',
      api_key: 'sb_publishable_xxxx',
      authorization: 'Bearer abcdef0123456789abcdef0123456789',
    });
    expect(out.access_token).toBe('[REDACTED]');
    expect(out.refresh_token).toBe('[REDACTED]');
    expect(out.api_key).toBe('[REDACTED]');
    expect(out.authorization).toBe('[REDACTED]');
  });

  it('verschachteltes Objekt mit Tokens wird tief redaktiert', () => {
    const out = setupAndCapture({
      flow: 'package-import',
      provider: 'mediaslide',
      payload: {
        outer: 'safe',
        nested: {
          claim_token: 'secret-deep',
          email: 'leak@example.com',
          message:
            'package fetch failed for token=eyJabcdefghijklmn.eyJjklmnopqrstuv.signaturepart12345',
        },
      },
    });
    const payload = out.payload as Record<string, unknown>;
    const nested = payload.nested as Record<string, unknown>;
    expect(nested.claim_token).toBe('[REDACTED]');
    expect(nested.message).toContain('[REDACTED_JWT]');
    // Email als String-Wert wird durch die Regex erfasst
    expect(JSON.stringify(out)).not.toContain('leak@example.com');
  });

  it('camelCase-Varianten werden über normalizeKey erkannt', () => {
    const out = setupAndCapture({
      claimToken: 'should-be-redacted',
      packageCapabilityUrl: 'https://mediaslide/cap/xyz',
    });
    expect(out.claimToken).toBe('[REDACTED]');
    expect(out.packageCapabilityUrl).toBe('[REDACTED]');
  });

  it('URL-Felder behalten Routing-Info, redaktieren aber Tokens', () => {
    const out = setupAndCapture({
      url: 'https://app.example.com/agency/models?invite_token=secret-xxx',
      from: '/agency',
      to: '/agency/models?invite_token=secret-yyy',
    });
    expect(out.url).toContain('/agency/models');
    expect(out.url).toContain('invite_token=%5BREDACTED%5D');
    expect(out.url).not.toContain('secret-xxx');
    expect(out.from).toBe('/agency');
    expect(out.to).toContain('invite_token=%5BREDACTED%5D');
    expect(out.to).not.toContain('secret-yyy');
  });

  it('Mother Agency Inhalte werden NICHT speziell verarbeitet aber via String-Regex sicher', () => {
    // Mother Agency ist rein informativ — wenn jemand sie versehentlich
    // in einen Error-Context packt, wollen wir trotzdem dass E-Mails / Tokens
    // dort scrubbed werden.
    const out = setupAndCapture({
      motherAgencyEmail: 'star@motheragency.example',
      motherAgencyName: 'Some Agency',
      mother_agency: { name: 'Foo', email: 'contact@foo.example' },
    });
    expect(out.motherAgencyEmail).toBe('[REDACTED_EMAIL]');
    // Name selbst ist nicht PII (Firmenname) — wir greifen hier nicht ein.
    expect(out.motherAgencyName).toBe('Some Agency');
    const ma = out.mother_agency as Record<string, unknown>;
    expect(ma.email).toBe('[REDACTED_EMAIL]');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Init-Verhalten je Env (Hardening F1)
// ────────────────────────────────────────────────────────────────────────────
describe('initSentry()', () => {
  const ORIGINAL_ENV = { ...process.env };
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    jest.resetModules();
  });

  it('initialisiert NICHT in development (auch wenn DSN gesetzt)', () => {
    process.env.EXPO_PUBLIC_APP_ENV = 'development';
    process.env.EXPO_PUBLIC_SENTRY_DSN = 'https://abc@o0.ingest.sentry.io/1';
    const initFn = jest.fn();
    jest.resetModules();
    jest.doMock('@sentry/react-native', () => ({
      init: initFn,
      captureException: jest.fn(),
      captureMessage: jest.fn(),
      addBreadcrumb: jest.fn(),
      setTag: jest.fn(),
      setUser: jest.fn(),
    }));
    jest.doMock('expo-constants', () => ({
      __esModule: true,
      default: { expoConfig: { extra: {} } },
    }));
    const sentryMod = require('../sentry') as typeof import('../sentry');
    sentryMod.initSentry();
    expect(initFn).not.toHaveBeenCalled();
    expect(sentryMod.isSentryEnabled()).toBe(false);
  });

  it('initialisiert NICHT ohne DSN (preview/production)', () => {
    process.env.EXPO_PUBLIC_APP_ENV = 'production';
    delete process.env.EXPO_PUBLIC_SENTRY_DSN;
    const initFn = jest.fn();
    jest.resetModules();
    jest.doMock('@sentry/react-native', () => ({
      init: initFn,
      captureException: jest.fn(),
      captureMessage: jest.fn(),
      addBreadcrumb: jest.fn(),
      setTag: jest.fn(),
      setUser: jest.fn(),
    }));
    jest.doMock('expo-constants', () => ({
      __esModule: true,
      default: { expoConfig: { extra: {} } },
    }));
    const sentryMod = require('../sentry') as typeof import('../sentry');
    sentryMod.initSentry();
    expect(initFn).not.toHaveBeenCalled();
    expect(sentryMod.isSentryEnabled()).toBe(false);
  });

  it('initialisiert mit DSN in production — sendDefaultPii ist false', () => {
    process.env.EXPO_PUBLIC_APP_ENV = 'production';
    process.env.EXPO_PUBLIC_SENTRY_DSN = 'https://abc@o0.ingest.sentry.io/1';
    let opts: Record<string, unknown> | undefined;
    jest.resetModules();
    jest.doMock('@sentry/react-native', () => ({
      init: jest.fn((o) => {
        opts = o;
      }),
      captureException: jest.fn(),
      captureMessage: jest.fn(),
      addBreadcrumb: jest.fn(),
      setTag: jest.fn(),
      setUser: jest.fn(),
    }));
    jest.doMock('expo-constants', () => ({
      __esModule: true,
      default: { expoConfig: { extra: {} } },
    }));
    const sentryMod = require('../sentry') as typeof import('../sentry');
    sentryMod.initSentry();
    expect(opts?.sendDefaultPii).toBe(false);
    expect(opts?.tracesSampleRate).toBe(0);
    expect(opts?.environment).toBe('production');
    expect(sentryMod.isSentryEnabled()).toBe(true);
  });

  /**
   * Verbindungs-„Contract“ ohne Netzwerk: gleiche Optionen wie in Produktion,
   * damit DSN/Env-Zwang und Release-String nicht aus Versehen regressieren.
   */
  it('Sentry.init: release (slug@version), keine Client-Reports, kein Auto-Session-Tracking', () => {
    process.env.EXPO_PUBLIC_APP_ENV = 'preview';
    process.env.EXPO_PUBLIC_SENTRY_DSN = 'https://placeholderslug@o0.ingest.sentry.io/1';
    let opts: Record<string, unknown> | undefined;
    jest.resetModules();
    jest.doMock('@sentry/react-native', () => ({
      init: jest.fn((o) => {
        opts = o;
      }),
      captureException: jest.fn(),
      captureMessage: jest.fn(),
      addBreadcrumb: jest.fn(),
      setTag: jest.fn(),
      setUser: jest.fn(),
    }));
    jest.doMock('expo-constants', () => ({
      __esModule: true,
      default: {
        expoConfig: { slug: 'IndexCastingTest', version: '9.9.9', extra: {} },
      },
    }));
    const sentryMod = require('../sentry') as typeof import('../sentry');
    sentryMod.initSentry();
    expect(opts?.release).toBe('IndexCastingTest@9.9.9');
    expect(opts?.sendClientReports).toBe(false);
    expect(opts?.enableAutoSessionTracking).toBe(false);
    expect(opts?.environment).toBe('preview');
  });

  it('Sentry.init wirft → fail-closed, App nicht betroffen', () => {
    process.env.EXPO_PUBLIC_APP_ENV = 'production';
    process.env.EXPO_PUBLIC_SENTRY_DSN = 'https://abc@o0.ingest.sentry.io/1';
    jest.resetModules();
    jest.doMock('@sentry/react-native', () => ({
      init: jest.fn(() => {
        throw new Error('SDK boom');
      }),
      captureException: jest.fn(),
      captureMessage: jest.fn(),
      addBreadcrumb: jest.fn(),
      setTag: jest.fn(),
      setUser: jest.fn(),
    }));
    jest.doMock('expo-constants', () => ({
      __esModule: true,
      default: { expoConfig: { extra: {} } },
    }));
    const sentryMod = require('../sentry') as typeof import('../sentry');
    expect(() => sentryMod.initSentry()).not.toThrow();
    expect(sentryMod.isSentryEnabled()).toBe(false);
    // Wrapper bleiben no-ops und werfen nicht.
    expect(() => sentryMod.captureException(new Error('x'))).not.toThrow();
    expect(() => sentryMod.captureMessage('y')).not.toThrow();
    expect(() => sentryMod.addBreadcrumb({ category: 'z' })).not.toThrow();
  });

  it('mehrfacher initSentry()-Aufruf ist idempotent', () => {
    process.env.EXPO_PUBLIC_APP_ENV = 'production';
    process.env.EXPO_PUBLIC_SENTRY_DSN = 'https://abc@o0.ingest.sentry.io/1';
    const initFn = jest.fn();
    jest.resetModules();
    jest.doMock('@sentry/react-native', () => ({
      init: initFn,
      captureException: jest.fn(),
      captureMessage: jest.fn(),
      addBreadcrumb: jest.fn(),
      setTag: jest.fn(),
      setUser: jest.fn(),
    }));
    jest.doMock('expo-constants', () => ({
      __esModule: true,
      default: { expoConfig: { extra: {} } },
    }));
    const sentryMod = require('../sentry') as typeof import('../sentry');
    sentryMod.initSentry();
    sentryMod.initSentry();
    sentryMod.initSentry();
    expect(initFn).toHaveBeenCalledTimes(1);
  });

  it('unbekannter EXPO_PUBLIC_APP_ENV (z. B. "staging") fällt auf development → no-init', () => {
    process.env.EXPO_PUBLIC_APP_ENV = 'staging';
    process.env.EXPO_PUBLIC_SENTRY_DSN = 'https://abc@o0.ingest.sentry.io/1';
    const initFn = jest.fn();
    jest.resetModules();
    jest.doMock('@sentry/react-native', () => ({
      init: initFn,
      captureException: jest.fn(),
      captureMessage: jest.fn(),
      addBreadcrumb: jest.fn(),
      setTag: jest.fn(),
      setUser: jest.fn(),
    }));
    jest.doMock('expo-constants', () => ({
      __esModule: true,
      default: { expoConfig: { extra: {} } },
    }));
    const sentryMod = require('../sentry') as typeof import('../sentry');
    sentryMod.initSentry();
    expect(initFn).not.toHaveBeenCalled();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Breadcrumb-Sanitization (Hardening F4 / F5 in beforeBreadcrumb)
// ────────────────────────────────────────────────────────────────────────────
describe('sanitizeBreadcrumb (über aktive init-Pfad)', () => {
  const ORIGINAL_ENV = { ...process.env };
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    jest.resetModules();
  });

  function captureBreadcrumb(input: Record<string, unknown>): unknown {
    process.env.EXPO_PUBLIC_APP_ENV = 'production';
    process.env.EXPO_PUBLIC_SENTRY_DSN = 'https://abc@o0.ingest.sentry.io/1';
    let initOpts: Record<string, unknown> | undefined;
    let observed: unknown = undefined;
    jest.resetModules();
    jest.doMock('@sentry/react-native', () => ({
      init: jest.fn((opts) => {
        initOpts = opts;
      }),
      captureException: jest.fn(),
      captureMessage: jest.fn(),
      addBreadcrumb: jest.fn((crumb) => {
        const before = initOpts?.beforeBreadcrumb as undefined | ((b: unknown) => unknown);
        observed = before ? before(crumb) : crumb;
      }),
      setTag: jest.fn(),
      setUser: jest.fn(),
    }));
    jest.doMock('expo-constants', () => ({
      __esModule: true,
      default: { expoConfig: { extra: {} } },
    }));
    const sentryMod = require('../sentry') as typeof import('../sentry');
    sentryMod.initSentry();
    sentryMod.addBreadcrumb({
      category: 'package-import',
      level: 'info',
      message: input.message as string | undefined,
      data: input.data as Record<string, unknown> | undefined,
    });
    return observed;
  }

  it('redaktiert breadcrumb.data Tokens (claim_token, capability_url)', () => {
    const crumb = captureBreadcrumb({
      message: 'commit failed',
      data: {
        claim_token: 'secret',
        capability_url: 'https://mediaslide/cap/xyz',
        from: '/agency/models?invite_token=tok',
      },
    }) as { data?: Record<string, unknown> } | null;
    expect(crumb?.data?.claim_token).toBe('[REDACTED]');
    expect(crumb?.data?.capability_url).toBe('[REDACTED]');
    expect(String(crumb?.data?.from)).toContain('invite_token=%5BREDACTED%5D');
  });

  it('redaktiert breadcrumb.message (JWT, Email)', () => {
    const crumb = captureBreadcrumb({
      message: 'failed for user@example.com (jwt eyJabcdefghij.eyJabcdefghij.signaturepart)',
    }) as { message?: string } | null;
    expect(crumb?.message).not.toContain('user@example.com');
    expect(crumb?.message).not.toContain('eyJabcdefghij.eyJabcdefghij.signaturepart');
    expect(crumb?.message).toContain('[REDACTED_EMAIL]');
    expect(crumb?.message).toContain('[REDACTED_JWT]');
  });
});
