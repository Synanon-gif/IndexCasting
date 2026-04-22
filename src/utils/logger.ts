/**
 * Observability Logger — Frontend (Web + Native)
 *
 * Lightweight wrapper around `console.*` that ALSO ships structured events
 * to Supabase (`public.record_system_event` RPC). Designed to be:
 *
 * - **Additive**: never replaces or hides `console.*`; existing logs keep working.
 * - **Fail-closed for the user**: RPC errors are swallowed; logging must never
 *   break a user flow.
 * - **PII-safe**: built-in redaction of common PII patterns before any network
 *   transport (emails, JWTs, common token-shaped values, long base64-ish blobs).
 * - **Throttled**: identical events within a short window collapse into one
 *   network call (in-memory dedupe; per-device, per-tab).
 * - **Cheap by default**: only `warn` / `error` / `fatal` are shipped; `debug`
 *   / `info` stay local unless the call site opts in via `{ ship: true }`.
 *
 * This is the **observability** logger (system_events).
 * It is ORTHOGONAL to `logAction` (audit_trail / compliance).
 * Do NOT route compliance audit calls through here.
 */

import { Platform } from 'react-native';
import { supabase } from '../../lib/supabase';
import {
  captureException as sentryCaptureException,
  captureMessage as sentryCaptureMessage,
  addBreadcrumb as sentryAddBreadcrumb,
} from '../observability/sentry';

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export type LogContext = {
  /** Free-form structured context. Will be JSON-serialized + PII-redacted. */
  [key: string]: unknown;
};

export type LogOptions = {
  /**
   * Force-ship to backend even if level is below the default threshold.
   * Default: warn/error/fatal are shipped automatically.
   */
  ship?: boolean;
  /**
   * Override the dedupe key (defaults to `${level}:${source}:${message}`).
   */
  dedupeKey?: string;
  /**
   * Optional org_id / user_id hints to enrich the event server-side.
   * If omitted, server uses auth.uid() and tries to resolve the org from membership.
   */
  orgId?: string | null;
  userId?: string | null;
};

// ────────────────────────────────────────────────────────────────────────────
// Configuration
// ────────────────────────────────────────────────────────────────────────────

const DEFAULT_SHIP_LEVELS: ReadonlySet<LogLevel> = new Set(['warn', 'error', 'fatal']);

/** Drop duplicate events within this window (ms). */
const DEDUPE_WINDOW_MS = 30_000;

/** Hard cap of in-flight ship attempts; older entries are evicted. */
const DEDUPE_MAX_ENTRIES = 500;

// ────────────────────────────────────────────────────────────────────────────
// PII Redaction
// ────────────────────────────────────────────────────────────────────────────

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const JWT_RE = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g;
const BEARER_RE = /[Bb]earer\s+[A-Za-z0-9._-]{20,}/g;
const LONG_HEX_RE = /\b[a-f0-9]{32,}\b/gi;
const LONG_B64_RE = /\b[A-Za-z0-9+/]{40,}={0,2}\b/g;

/** Redact PII from a string. Best-effort; not a substitute for not logging secrets. */
export function redactString(value: string): string {
  if (!value) return value;
  return value
    .replace(JWT_RE, '[REDACTED_JWT]')
    .replace(BEARER_RE, 'Bearer [REDACTED]')
    .replace(EMAIL_RE, '[REDACTED_EMAIL]')
    .replace(LONG_HEX_RE, '[REDACTED_HEX]')
    .replace(LONG_B64_RE, '[REDACTED_B64]');
}

/** Recursively redact strings inside an arbitrary value. Safe for cycles via WeakSet. */
export function redactValue(value: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
  if (value == null) return value;
  if (typeof value === 'string') return redactString(value);
  if (typeof value !== 'object') return value;
  if (seen.has(value as object)) return '[Circular]';
  seen.add(value as object);

  if (Array.isArray(value)) {
    return value.map((v) => redactValue(v, seen));
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    // Drop obvious secret-shaped keys entirely.
    if (/^(password|access_token|refresh_token|api_key|secret|service_role)$/i.test(k)) {
      out[k] = '[REDACTED]';
      continue;
    }
    out[k] = redactValue(v, seen);
  }
  return out;
}

// ────────────────────────────────────────────────────────────────────────────
// Throttling / Dedupe
// ────────────────────────────────────────────────────────────────────────────

const dedupeMap = new Map<string, number>();

function shouldShip(key: string, now: number): boolean {
  const last = dedupeMap.get(key);
  if (last != null && now - last < DEDUPE_WINDOW_MS) {
    return false;
  }
  dedupeMap.set(key, now);
  // Soft-evict oldest entries if we're over the cap.
  if (dedupeMap.size > DEDUPE_MAX_ENTRIES) {
    const firstKey = dedupeMap.keys().next().value;
    if (firstKey) dedupeMap.delete(firstKey);
  }
  return true;
}

// ────────────────────────────────────────────────────────────────────────────
// Console mirror
// ────────────────────────────────────────────────────────────────────────────

function mirrorToConsole(
  level: LogLevel,
  source: string,
  message: string,
  context?: LogContext,
): void {
  const prefix = `[${source}]`;
  const args: unknown[] = context ? [prefix, message, context] : [prefix, message];
  switch (level) {
    case 'debug':
      console.debug(...args);
      break;
    case 'info':
      console.info(...args);
      break;
    case 'warn':
      console.warn(...args);
      break;
    case 'error':
    case 'fatal':
      console.error(...args);
      break;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Ship to backend (fire-and-forget)
// ────────────────────────────────────────────────────────────────────────────

function platformLabel(): string {
  // Platform.OS is one of: 'web' | 'ios' | 'android' | 'windows' | 'macos'
  return `${Platform.OS}`;
}

async function shipEventToBackend(
  level: LogLevel,
  source: string,
  message: string,
  context: LogContext | undefined,
  opts: LogOptions,
): Promise<void> {
  try {
    const safeContext = context ? (redactValue(context) as Record<string, unknown>) : null;
    const safeMessage = redactString(message);
    // The DB enforces `source IN ('frontend','edge','db','cron','system')`.
    // The TS API accepts a free-form `source` (e.g. 'optionRequests', 'AppErrorBoundary')
    // which is the *logical* origin within the frontend layer. We therefore:
    //   - pin `p_source = 'frontend'` (the platform-layer enum value), and
    //   - pass the caller-provided `source` as `p_event` (a stable machine-readable
    //     event identifier — required NOT NULL by record_system_event).
    // The original logical source is also preserved in the context for triage.
    const enriched: Record<string, unknown> = {
      ...(safeContext ?? {}),
      _platform: platformLabel(),
      _source: source,
    };
    if (opts.orgId) enriched._org_id = opts.orgId;
    if (opts.userId) enriched._user_id = opts.userId;

    // Fire-and-forget: do not await, do not surface errors.
    void supabase
      .rpc('record_system_event', {
        p_level: level,
        p_source: 'frontend',
        p_event: source,
        p_message: safeMessage,
        p_context: enriched,
      })
      .then(({ error }) => {
        if (error) {
          // Last-resort console log; never throw.
          console.warn('[logger] record_system_event failed', error.message);
        }
      });
  } catch {
    // Never let the logger break the caller.
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────────

function emit(
  level: LogLevel,
  source: string,
  message: string,
  context?: LogContext,
  opts: LogOptions = {},
): void {
  // 1) Always mirror to console (never break existing debug habits).
  mirrorToConsole(level, source, message, context);

  // 2) Decide whether to ship to backend.
  const ship = opts.ship === true || DEFAULT_SHIP_LEVELS.has(level);
  if (!ship) return;

  // 3) Throttle.
  const dedupeKey = opts.dedupeKey ?? `${level}:${source}:${message}`;
  if (!shouldShip(dedupeKey, Date.now())) return;

  // 4) Ship to Supabase (existing observability) AND Sentry (additive).
  //    Sentry-Aufrufe sind no-ops wenn nicht initialisiert (kein DSN / dev).
  void shipEventToBackend(level, source, message, context, opts);
  shipToSentry(level, source, message, context);
}

/**
 * Forwarded zu Sentry — error/fatal als Exception, warn als breadcrumb+message.
 * Scrubbing passiert in `src/observability/sentry.ts#beforeSend`/`redactDeep`,
 * dieser Aufruf bleibt damit minimal.
 */
function shipToSentry(
  level: LogLevel,
  source: string,
  message: string,
  context?: LogContext,
): void {
  try {
    if (level === 'error' || level === 'fatal') {
      // Falls der Aufrufer ein echtes Error-Objekt im Context mitgibt,
      // bevorzugen wir das (sauberer Stacktrace in Sentry).
      const maybeError =
        context && typeof context === 'object' && 'error' in context
          ? (context as { error?: unknown }).error
          : undefined;
      // Hardening (2026-04, F10): den `error`-Key aus dem Extra-Context
      // entfernen, damit das Error-Objekt nicht doppelt serialisiert wird
      // (einmal als Sentry-Exception, einmal als JSON-Blob im Extra).
      const extra = stripErrorFromContext(context);
      if (maybeError instanceof Error) {
        sentryCaptureException(maybeError, { source, message, ...extra });
      } else {
        sentryCaptureMessage(`[${source}] ${message}`, level === 'fatal' ? 'fatal' : 'error', {
          source,
          ...extra,
        });
      }
    } else if (level === 'warn') {
      sentryAddBreadcrumb({
        category: source,
        level: 'warning',
        message,
        data: stripErrorFromContext(context) as Record<string, unknown> | undefined,
      });
    }
  } catch {
    // Sentry darf den Logger niemals brechen.
  }
}

function stripErrorFromContext(context?: LogContext): Record<string, unknown> | undefined {
  if (!context || typeof context !== 'object') return context as undefined;
  const obj = context as Record<string, unknown>;
  if (!('error' in obj)) return obj;
  const { error: _ignored, ...rest } = obj;
  void _ignored;
  return rest;
}

export const logger = {
  debug: (source: string, message: string, context?: LogContext, opts?: LogOptions) =>
    emit('debug', source, message, context, opts),
  info: (source: string, message: string, context?: LogContext, opts?: LogOptions) =>
    emit('info', source, message, context, opts),
  warn: (source: string, message: string, context?: LogContext, opts?: LogOptions) =>
    emit('warn', source, message, context, opts),
  error: (source: string, message: string, context?: LogContext, opts?: LogOptions) =>
    emit('error', source, message, context, opts),
  fatal: (source: string, message: string, context?: LogContext, opts?: LogOptions) =>
    emit('fatal', source, message, context, opts),
} as const;

/** Test-only: clears the dedupe map. Do not use in production code. */
export function __resetLoggerDedupeForTests(): void {
  dedupeMap.clear();
}
