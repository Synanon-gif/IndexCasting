/**
 * Sentry Integration — minimal, DSGVO-bewusst, opt-in via DSN.
 *
 * Designprinzipien (siehe Cursor-Rule `system-invariants.mdc` und `.cursorrules`):
 *  - **Fail-closed**: Fehlt der DSN oder schlägt `init` fehl, wird die App
 *    NICHT verändert. Sentry ist additiv und niemals blocking.
 *  - **PII-safe**: `sendDefaultPii: false`. `beforeSend` / `beforeBreadcrumb`
 *    redaktieren bekannte sensible Tokens (Claim-/Invite-/Package-URLs),
 *    JWTs, Bearer-Header, Supabase-Keys, E-Mails.
 *  - **Minimal Scope**: KEIN Performance-Monitoring, KEIN Session Replay,
 *    KEIN Logging-Overhaul, KEINE Profiling-Pipeline. Nur Crash-/Error-Reporting.
 *  - **Env-getrennt**: development|preview|production via `EXPO_PUBLIC_APP_ENV`.
 *
 * Dieses Modul wird ein einziges Mal aus `index.ts` initialisiert.
 * Alle anderen Aufrufer benutzen `captureException`, `captureMessage`,
 * `addBreadcrumb`, `setFlowContext` — die sind sichere No-Ops, wenn Sentry
 * nicht initialisiert ist.
 */

import * as Sentry from '@sentry/react-native';
import Constants from 'expo-constants';

// ────────────────────────────────────────────────────────────────────────────
// Config
// ────────────────────────────────────────────────────────────────────────────

type AppEnv = 'development' | 'preview' | 'production';

type ExtraConfig = {
  sentryDsn?: string;
  appEnv?: string;
  appUrl?: string;
} & Record<string, unknown>;

function readExtra(): ExtraConfig {
  return (Constants.expoConfig as { extra?: ExtraConfig } | null)?.extra ?? {};
}

function readDsn(): string {
  const fromExtra = readExtra().sentryDsn;
  if (typeof fromExtra === 'string' && fromExtra.trim()) return fromExtra.trim();
  if (typeof process !== 'undefined' && process.env) {
    const v = process.env.EXPO_PUBLIC_SENTRY_DSN;
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

function readEnv(): AppEnv {
  const raw =
    readExtra().appEnv ??
    (typeof process !== 'undefined' ? process.env?.EXPO_PUBLIC_APP_ENV : undefined);
  if (raw === 'production' || raw === 'preview') return raw;
  return 'development';
}

let initialized = false;
let initFailed = false;

// ────────────────────────────────────────────────────────────────────────────
// Scrubbing — bekannte sensible Query-Parameter und String-Patterns
// ────────────────────────────────────────────────────────────────────────────

/**
 * Query-Parameter, die NIE im Klartext zu Sentry dürfen.
 * Stimmt mit den im Projekt verwendeten Capability-/Token-URLs überein:
 *  - `model_invite`  → ModelClaimToken (siehe modelsSupabase.ts buildModelClaimUrl)
 *  - `invite_token`  → Organisation Invite (organizationsInvitationsSupabase)
 *  - `code`/`token`  → Supabase Auth Reset/Magic-Link
 *  - `package_url` / `package_capability_url` → MediaSlide Capability-URL (sehr sensibel)
 *  - `access_token` / `refresh_token` → Supabase Session
 */
const SENSITIVE_QUERY_PARAMS: ReadonlySet<string> = new Set([
  'model_invite',
  'invite_token',
  'invite',
  'token',
  'code',
  'access_token',
  'refresh_token',
  'package_url',
  'package_capability_url',
  'capability_url',
  'capability',
  'apikey',
  'api_key',
  'key',
  'secret',
  'authorization',
]);

/** Header, die niemals roh durchgereicht werden. */
const SENSITIVE_HEADERS: ReadonlySet<string> = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'apikey',
  'x-supabase-auth',
  'x-api-key',
  'x-csrf-token',
]);

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const JWT_RE = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g;
const BEARER_RE = /[Bb]earer\s+[A-Za-z0-9._-]{20,}/g;
const LONG_HEX_RE = /\b[a-f0-9]{32,}\b/gi;

function redactString(value: string): string {
  if (!value) return value;
  return value
    .replace(JWT_RE, '[REDACTED_JWT]')
    .replace(BEARER_RE, 'Bearer [REDACTED]')
    .replace(EMAIL_RE, '[REDACTED_EMAIL]')
    .replace(LONG_HEX_RE, '[REDACTED_HEX]');
}

/**
 * Maskiert sensible Query-Parameter in einer URL — und ersetzt zusätzlich
 * lange Token-Pfadsegmente (z. B. `/auth/v1/verify/<token>`) durch Platzhalter.
 * Wenn die URL nicht parsebar ist, wird der String generisch redaktiert.
 */
export function redactUrl(rawUrl: string): string {
  if (!rawUrl || typeof rawUrl !== 'string') return rawUrl;
  // Only treat as URL when it looks absolute or starts with `?` / `/`.
  const looksAbsolute = /^[a-z][a-z0-9+.-]*:\/\//i.test(rawUrl);
  const looksPathOrQuery = rawUrl.startsWith('/') || rawUrl.startsWith('?');
  if (!looksAbsolute && !looksPathOrQuery) {
    return redactString(rawUrl);
  }
  try {
    const u = new URL(rawUrl, 'https://placeholder.local');
    let mutated = false;
    for (const key of Array.from(u.searchParams.keys())) {
      if (SENSITIVE_QUERY_PARAMS.has(key.toLowerCase())) {
        u.searchParams.set(key, '[REDACTED]');
        mutated = true;
      }
    }
    const isPlaceholder = u.origin === 'https://placeholder.local';
    const out = isPlaceholder ? `${u.pathname}${u.search}${u.hash}` : u.toString();
    return mutated ? out : redactString(out);
  } catch {
    return redactString(rawUrl);
  }
}

function redactHeaders(headers: unknown): unknown {
  if (!headers || typeof headers !== 'object') return headers;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(headers as Record<string, unknown>)) {
    if (SENSITIVE_HEADERS.has(k.toLowerCase())) {
      out[k] = '[REDACTED]';
    } else if (typeof v === 'string') {
      out[k] = redactString(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function redactDeep(value: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
  if (value == null) return value;
  if (typeof value === 'string') return redactString(value);
  if (typeof value !== 'object') return value;
  if (seen.has(value as object)) return '[Circular]';
  seen.add(value as object);
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, seen));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (/^(password|access_token|refresh_token|api_key|secret|service_role|token)$/i.test(k)) {
      out[k] = '[REDACTED]';
      continue;
    }
    if (/url$/i.test(k) && typeof v === 'string') {
      out[k] = redactUrl(v);
      continue;
    }
    out[k] = redactDeep(v, seen);
  }
  return out;
}

// ────────────────────────────────────────────────────────────────────────────
// Event / Breadcrumb Sanitizer
// ────────────────────────────────────────────────────────────────────────────

function sanitizeEvent(event: Sentry.ErrorEvent): Sentry.ErrorEvent | null {
  try {
    // Drop user PII (we explicitly do not send IPs / emails by default).
    if (event.user) {
      const { id } = event.user;
      event.user = id ? { id } : undefined;
    }

    if (event.request) {
      if (typeof event.request.url === 'string') {
        event.request.url = redactUrl(event.request.url);
      }
      if (event.request.headers) {
        event.request.headers = redactHeaders(event.request.headers) as Record<string, string>;
      }
      if (event.request.cookies) {
        event.request.cookies = '[REDACTED]' as unknown as Record<string, string>;
      }
      if (event.request.data) {
        event.request.data = redactDeep(event.request.data);
      }
      if (typeof event.request.query_string === 'string') {
        event.request.query_string = redactUrl(`?${event.request.query_string}`).replace(/^\?/, '');
      }
    }

    if (event.message) {
      event.message = redactString(event.message);
    }

    if (event.extra) event.extra = redactDeep(event.extra) as Record<string, unknown>;
    if (event.contexts) event.contexts = redactDeep(event.contexts) as typeof event.contexts;
    if (event.tags) event.tags = redactDeep(event.tags) as typeof event.tags;

    if (Array.isArray(event.breadcrumbs)) {
      event.breadcrumbs = event.breadcrumbs.map((b) => sanitizeBreadcrumb(b) ?? b);
    }
  } catch {
    // never let scrubbing crash event delivery — drop event to be safe.
    return null;
  }
  return event;
}

function sanitizeBreadcrumb(breadcrumb: Sentry.Breadcrumb): Sentry.Breadcrumb | null {
  try {
    if (breadcrumb.message) breadcrumb.message = redactString(breadcrumb.message);
    if (breadcrumb.data) {
      const data = breadcrumb.data as Record<string, unknown>;
      if (typeof data.url === 'string') data.url = redactUrl(data.url);
      if (typeof data.from === 'string') data.from = redactUrl(data.from);
      if (typeof data.to === 'string') data.to = redactUrl(data.to);
      breadcrumb.data = redactDeep(data) as Record<string, unknown>;
    }
    // Drop noisy console.debug / console.log in production traces.
    if (
      breadcrumb.category === 'console' &&
      (breadcrumb.level === 'debug' || breadcrumb.level === 'log')
    ) {
      return null;
    }
  } catch {
    return null;
  }
  return breadcrumb;
}

// ────────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────────

export function isSentryEnabled(): boolean {
  return initialized && !initFailed;
}

export function initSentry(): void {
  if (initialized || initFailed) return;
  const dsn = readDsn();
  if (!dsn) {
    // No DSN → silently disabled (dev/local). Do not warn: avoids log spam.
    return;
  }
  const environment = readEnv();
  try {
    Sentry.init({
      dsn,
      environment,
      // DSGVO: keine Default-PII (IP, Cookies, User-Agent-Detail).
      sendDefaultPii: false,
      // In dev nichts an Sentry schicken — nur Console-Warnung.
      enabled: environment !== 'development',
      // Konservative Sample-Rates: 100 % Errors, 0 % Performance.
      sampleRate: 1.0,
      tracesSampleRate: 0,
      // Kein Session Replay / Profiling im Minimal-Setup.
      attachStacktrace: true,
      // Erst absichern, dann senden.
      beforeSend: sanitizeEvent,
      beforeBreadcrumb: sanitizeBreadcrumb,
      // Bekannte Noise-Quellen filtern.
      ignoreErrors: [
        // Extension-/Webview-Spam, kein App-Bug.
        'ResizeObserver loop completed with undelivered notifications.',
        'ResizeObserver loop limit exceeded',
        // Network-Aborts (User navigiert weg) — kein Crash.
        'AbortError',
      ],
    });
    initialized = true;
  } catch (err) {
    initFailed = true;
    // Letzter Resort: Console — niemals werfen.
    if (typeof console !== 'undefined') {
      console.warn('[sentry] init failed', (err as Error)?.message ?? err);
    }
  }
}

/** Reine No-Op-Wrapper, damit Aufrufer keine Sentry-Imports benötigen. */
export function captureException(err: unknown, context?: Record<string, unknown>): void {
  if (!isSentryEnabled()) return;
  try {
    Sentry.captureException(
      err,
      context ? { extra: redactDeep(context) as Record<string, unknown> } : undefined,
    );
  } catch {
    /* swallow */
  }
}

export function captureMessage(
  message: string,
  level: 'info' | 'warning' | 'error' | 'fatal' = 'info',
  context?: Record<string, unknown>,
): void {
  if (!isSentryEnabled()) return;
  try {
    Sentry.captureMessage(redactString(message), {
      level,
      ...(context ? { extra: redactDeep(context) as Record<string, unknown> } : {}),
    });
  } catch {
    /* swallow */
  }
}

export function addBreadcrumb(crumb: {
  category: string;
  message?: string;
  level?: 'info' | 'warning' | 'error' | 'fatal' | 'debug';
  data?: Record<string, unknown>;
}): void {
  if (!isSentryEnabled()) return;
  try {
    Sentry.addBreadcrumb({
      category: crumb.category,
      level: crumb.level ?? 'info',
      message: crumb.message ? redactString(crumb.message) : undefined,
      data: crumb.data ? (redactDeep(crumb.data) as Record<string, unknown>) : undefined,
    });
  } catch {
    /* swallow */
  }
}

/**
 * Setzt einen Flow-/Screen-Tag, damit Errors in Sentry gruppiert werden.
 * Bewusst KEIN PII (kein Username, keine E-Mail).
 */
export function setFlowContext(flow: {
  area?: 'agency' | 'client' | 'model' | 'admin' | 'guest' | 'auth' | 'public';
  screen?: string;
  provider?: 'mediaslide' | 'netwalk';
  importPhase?: string;
}): void {
  if (!isSentryEnabled()) return;
  try {
    if (flow.area) Sentry.setTag('area', flow.area);
    if (flow.screen) Sentry.setTag('screen', flow.screen);
    if (flow.provider) Sentry.setTag('provider', flow.provider);
    if (flow.importPhase) Sentry.setTag('import_phase', flow.importPhase);
  } catch {
    /* swallow */
  }
}

/**
 * Setzt eine pseudonyme User-ID (auth.uid()). KEINE E-Mail, KEIN Name.
 * Für DSGVO ausreichend, da es eine projektinterne UUID ist.
 */
export function setUserContext(userId: string | null): void {
  if (!isSentryEnabled()) return;
  try {
    if (userId) Sentry.setUser({ id: userId });
    else Sentry.setUser(null);
  } catch {
    /* swallow */
  }
}
