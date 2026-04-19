import {
  normalizePublicLegalPath,
  normalizeTrustPath,
  isStatusPath,
  getPublicAgencySlugFromPath,
  getPublicClientSlugFromPath,
} from '../publicLegalRoutes';

/**
 * Routing-Guards für die öffentlichen, auth-freien Web-Pfade.
 *
 * - Trust Center & Status sind public — sie dürfen NIEMALS mit Login/Session,
 *   Agency/Client-Profilen oder Legal-Pages kollidieren.
 * - Trailing-Slash-Toleranz und einfache Negativ-Pfade sind explizit getestet,
 *   weil sie sonst stille Falsch-Routings produzieren würden (z. B. /status/
 *   würde sonst auf den AuthScreen statt auf die Status-Seite fallen).
 */

describe('publicLegalRoutes — legacy /terms /privacy', () => {
  test('matches canonical paths', () => {
    expect(normalizePublicLegalPath('/terms')).toBe('terms');
    expect(normalizePublicLegalPath('/privacy')).toBe('privacy');
  });

  test('tolerates trailing slash', () => {
    expect(normalizePublicLegalPath('/terms/')).toBe('terms');
    expect(normalizePublicLegalPath('/privacy/')).toBe('privacy');
  });

  test('does not match unrelated paths', () => {
    expect(normalizePublicLegalPath('/')).toBeNull();
    expect(normalizePublicLegalPath('/trust')).toBeNull();
    expect(normalizePublicLegalPath('/status')).toBeNull();
    expect(normalizePublicLegalPath('/agency/foo')).toBeNull();
  });
});

describe('publicLegalRoutes — Trust Center routing', () => {
  test('maps each Trust path to its route id', () => {
    expect(normalizeTrustPath('/trust')).toBe('trust-center');
    expect(normalizeTrustPath('/trust/security')).toBe('trust-security');
    expect(normalizeTrustPath('/trust/dpa')).toBe('trust-dpa');
    expect(normalizeTrustPath('/trust/subprocessors')).toBe('trust-subprocessors');
    expect(normalizeTrustPath('/trust/gdpr')).toBe('trust-gdpr');
    expect(normalizeTrustPath('/trust/incident-response')).toBe('trust-incident-response');
  });

  test('tolerates trailing slash on every Trust path', () => {
    expect(normalizeTrustPath('/trust/')).toBe('trust-center');
    expect(normalizeTrustPath('/trust/security/')).toBe('trust-security');
    expect(normalizeTrustPath('/trust/dpa/')).toBe('trust-dpa');
    expect(normalizeTrustPath('/trust/subprocessors/')).toBe('trust-subprocessors');
    expect(normalizeTrustPath('/trust/gdpr/')).toBe('trust-gdpr');
    expect(normalizeTrustPath('/trust/incident-response/')).toBe('trust-incident-response');
  });

  test('does not match non-Trust paths', () => {
    expect(normalizeTrustPath('/')).toBeNull();
    expect(normalizeTrustPath('/terms')).toBeNull();
    expect(normalizeTrustPath('/privacy')).toBeNull();
    expect(normalizeTrustPath('/status')).toBeNull();
    expect(normalizeTrustPath('/trust/unknown')).toBeNull();
    expect(normalizeTrustPath('/trustcenter')).toBeNull();
    expect(normalizeTrustPath('/trust/security/details')).toBeNull();
  });

  test('does not collide with public agency / client profile paths', () => {
    expect(normalizeTrustPath('/agency/foo')).toBeNull();
    expect(normalizeTrustPath('/client/foo')).toBeNull();
    expect(getPublicAgencySlugFromPath('/trust')).toBeNull();
    expect(getPublicAgencySlugFromPath('/trust/security')).toBeNull();
    expect(getPublicClientSlugFromPath('/trust')).toBeNull();
    expect(getPublicClientSlugFromPath('/trust/security')).toBeNull();
  });
});

describe('publicLegalRoutes — Status page', () => {
  test('matches canonical /status', () => {
    expect(isStatusPath('/status')).toBe(true);
    expect(isStatusPath('/status/')).toBe(true);
  });

  test('does not match other paths', () => {
    expect(isStatusPath('/')).toBe(false);
    expect(isStatusPath('/trust')).toBe(false);
    expect(isStatusPath('/status-page')).toBe(false);
    expect(isStatusPath('/status/foo')).toBe(false);
    expect(isStatusPath('/agency/status')).toBe(false);
  });

  test('does not collide with agency/client slug routes', () => {
    expect(getPublicAgencySlugFromPath('/status')).toBeNull();
    expect(getPublicClientSlugFromPath('/status')).toBeNull();
  });
});
