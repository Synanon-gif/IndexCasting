/**
 * Redact secrets from URLs and log lines for E2E diagnostics (no secrets in CI artifacts).
 */

const SENSITIVE_QUERY_KEYS = new Set([
  'token',
  'access_token',
  'refresh_token',
  'apikey',
  'api_key',
  'key',
  'authorization',
  'auth',
]);

/** Strip obvious cookie / Set-Cookie fragments from free text (diagnostics only). */
export function redactCookieLike(text: string): string {
  return text
    .replace(/\b[a-z_]*cookie\s*[:=]\s*[^\s;]+/gi, 'cookie: [REDACTED]')
    .replace(/\bauthorization:\s*\S+/gi, 'authorization: [REDACTED]');
}

/**
 * Mask JWT-shaped substrings in free text.
 */
export function redactJwtLike(text: string): string {
  let t = text.replace(
    /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
    '[REDACTED_JWT]',
  );
  /** JWT prefix without word boundary (URLs, JSON) */
  t = t.replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, '[REDACTED_JWT]');
  t = t.replace(/\b(service_role|service[_-]?role)\b/gi, '[REDACTED_SERVICE_ROLE]');
  t = t.replace(/\baccess_token\b/gi, '[REDACTED_ACCESS_TOKEN]');
  t = t.replace(/\brefresh_token\b/gi, '[REDACTED_REFRESH_TOKEN]');
  t = t.replace(/\b(password|pwd)\s*[:=]\s*\S+/gi, '$1: [REDACTED]');
  return redactCookieLike(t);
}

export function redactAuthorizationHeader(value: string | undefined): string {
  if (!value) return '';
  if (/^bearer\s+/i.test(value)) return 'Bearer [REDACTED]';
  return '[REDACTED_AUTH_HEADER]';
}

export function redactUrl(raw: string): string {
  try {
    const u = new URL(raw);
    for (const k of [...u.searchParams.keys()]) {
      const lower = k.toLowerCase();
      if (
        SENSITIVE_QUERY_KEYS.has(lower) ||
        lower.includes('token') ||
        lower.includes('secret') ||
        lower.includes('password') ||
        lower.includes('apikey')
      ) {
        u.searchParams.set(k, '[REDACTED]');
      }
    }
    return redactJwtLike(u.toString());
  } catch {
    return redactJwtLike(raw.slice(0, 500));
  }
}
