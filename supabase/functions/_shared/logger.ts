/**
 * Edge Function Observability Logger
 *
 * Mirror of `src/utils/logger.ts` for the Deno / Edge Function runtime:
 *
 * - Writes structured events directly to `public.system_events` using the
 *   Service-Role key (Edge Functions are server-side and trusted).
 * - PII redaction: emails, JWTs, bearer tokens, long hex/base64.
 * - Throttling per (level + source + message) within a 30 s window.
 * - Fail-closed for the caller: logger errors NEVER bubble up.
 * - Console mirror so existing `console.*` lines keep working in Supabase
 *   function logs.
 *
 * Designed to wrap an entire `Deno.serve` handler via `withObservability`
 * so any uncaught exception is captured exactly once with full context.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export type LogContext = { [key: string]: unknown };

export type LogOptions = {
  ship?: boolean;
  dedupeKey?: string;
  orgId?: string | null;
  userId?: string | null;
};

// ────────────────────────────────────────────────────────────────────────────
// Configuration
// ────────────────────────────────────────────────────────────────────────────

const DEFAULT_SHIP_LEVELS: ReadonlySet<LogLevel> = new Set(['warn', 'error', 'fatal']);
const DEDUPE_WINDOW_MS = 30_000;
const DEDUPE_MAX_ENTRIES = 500;

// ────────────────────────────────────────────────────────────────────────────
// Service-role client (lazy)
// ────────────────────────────────────────────────────────────────────────────

let _adminClient: ReturnType<typeof createClient> | null = null;

function getAdminClient(): ReturnType<typeof createClient> | null {
  if (_adminClient) return _adminClient;
  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceKey) return null;
  _adminClient = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _adminClient;
}

// ────────────────────────────────────────────────────────────────────────────
// PII Redaction (mirror of frontend logger)
// ────────────────────────────────────────────────────────────────────────────

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const JWT_RE = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g;
const BEARER_RE = /[Bb]earer\s+[A-Za-z0-9._-]{20,}/g;
const LONG_HEX_RE = /\b[a-f0-9]{32,}\b/gi;
const LONG_B64_RE = /\b[A-Za-z0-9+/]{40,}={0,2}\b/g;

export function redactString(value: string): string {
  if (!value) return value;
  return value
    .replace(JWT_RE, '[REDACTED_JWT]')
    .replace(BEARER_RE, 'Bearer [REDACTED]')
    .replace(EMAIL_RE, '[REDACTED_EMAIL]')
    .replace(LONG_HEX_RE, '[REDACTED_HEX]')
    .replace(LONG_B64_RE, '[REDACTED_B64]');
}

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
    if (/^(password|access_token|refresh_token|api_key|secret|service_role)$/i.test(k)) {
      out[k] = '[REDACTED]';
      continue;
    }
    out[k] = redactValue(v, seen);
  }
  return out;
}

// ────────────────────────────────────────────────────────────────────────────
// Dedupe
// ────────────────────────────────────────────────────────────────────────────

const dedupeMap = new Map<string, number>();

function shouldShip(key: string, now: number): boolean {
  const last = dedupeMap.get(key);
  if (last != null && now - last < DEDUPE_WINDOW_MS) return false;
  dedupeMap.set(key, now);
  if (dedupeMap.size > DEDUPE_MAX_ENTRIES) {
    const firstKey = dedupeMap.keys().next().value;
    if (firstKey) dedupeMap.delete(firstKey);
  }
  return true;
}

// ────────────────────────────────────────────────────────────────────────────
// Console mirror
// ────────────────────────────────────────────────────────────────────────────

function mirrorToConsole(level: LogLevel, source: string, message: string, ctx?: LogContext): void {
  const prefix = `[${source}]`;
  const args: unknown[] = ctx ? [prefix, message, ctx] : [prefix, message];
  switch (level) {
    case 'debug': console.debug(...args); break;
    case 'info':  console.info(...args);  break;
    case 'warn':  console.warn(...args);  break;
    case 'error':
    case 'fatal': console.error(...args); break;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Ship to backend (direct INSERT — Edge Function is trusted)
// ────────────────────────────────────────────────────────────────────────────

async function shipEventToBackend(
  level: LogLevel,
  source: string,
  message: string,
  context: LogContext | undefined,
  opts: LogOptions,
): Promise<void> {
  try {
    const client = getAdminClient();
    if (!client) return; // No service-role key — silently no-op.

    const safeContext = context ? (redactValue(context) as Record<string, unknown>) : null;
    const safeMessage = redactString(message);
    // DB schema (system_events):
    //   - `source` is an enum: 'frontend' | 'edge' | 'db' | 'cron' | 'system'
    //     → MUST be the literal 'edge' here, not `edge:${name}`.
    //   - `event` is NOT NULL — use the caller-supplied logical source
    //     (e.g. function name 'send-invite') as the stable event identifier.
    //   - `actor_user_id` / `organization_id` are the canonical column names.
    const enriched: Record<string, unknown> = {
      ...(safeContext ?? {}),
      _runtime: 'edge',
      _source: source,
    };
    if (opts.orgId) enriched._org_id = opts.orgId;
    if (opts.userId) enriched._user_id = opts.userId;

    const { error } = await client.from('system_events').insert({
      level,
      source: 'edge',
      event: source,
      message: safeMessage,
      context: enriched,
      organization_id: opts.orgId ?? null,
      actor_user_id: opts.userId ?? null,
    });
    if (error) {
      console.warn('[edge-logger] insert failed', error.message);
    }
  } catch (e) {
    // Logger MUST never break the caller.
    console.warn('[edge-logger] ship exception', e instanceof Error ? e.message : String(e));
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
  mirrorToConsole(level, source, message, context);
  const ship = opts.ship === true || DEFAULT_SHIP_LEVELS.has(level);
  if (!ship) return;
  const dedupeKey = opts.dedupeKey ?? `${level}:${source}:${message}`;
  if (!shouldShip(dedupeKey, Date.now())) return;
  // Fire-and-forget — do not await; we do not want to block the response.
  void shipEventToBackend(level, source, message, context, opts);
}

export const logger = {
  debug: (s: string, m: string, c?: LogContext, o?: LogOptions) => emit('debug', s, m, c, o),
  info:  (s: string, m: string, c?: LogContext, o?: LogOptions) => emit('info',  s, m, c, o),
  warn:  (s: string, m: string, c?: LogContext, o?: LogOptions) => emit('warn',  s, m, c, o),
  error: (s: string, m: string, c?: LogContext, o?: LogOptions) => emit('error', s, m, c, o),
  fatal: (s: string, m: string, c?: LogContext, o?: LogOptions) => emit('fatal', s, m, c, o),
} as const;

// ────────────────────────────────────────────────────────────────────────────
// withObservability — wrap a Deno.serve handler
// ────────────────────────────────────────────────────────────────────────────

type Handler = (req: Request) => Promise<Response> | Response;

/**
 * Wraps an Edge Function handler so any uncaught exception is shipped to
 * `system_events` with full context (method, path, status, duration) and a
 * deterministic 500 response is returned to the caller.
 *
 * Successful responses are NOT logged by default — only failures (>=500) and
 * uncaught exceptions, to keep the events table cheap.
 *
 * Usage:
 *   Deno.serve(withObservability('send-invite', async (req) => { ... }));
 */
export function withObservability(functionName: string, handler: Handler): Handler {
  return async (req: Request): Promise<Response> => {
    const start = Date.now();
    let res: Response | null = null;
    try {
      res = await handler(req);
      const dur = Date.now() - start;
      if (res.status >= 500) {
        logger.error(functionName, 'edge_function_5xx', {
          method: req.method,
          path: new URL(req.url).pathname,
          status: res.status,
          duration_ms: dur,
        });
      }
      return res;
    } catch (e) {
      const dur = Date.now() - start;
      const err = e instanceof Error ? e : new Error(String(e));
      logger.fatal(functionName, err.message || 'edge_function_unhandled_exception', {
        method: req.method,
        path: new URL(req.url).pathname,
        duration_ms: dur,
        stack: err.stack ?? null,
        name: err.name,
      });
      // Deterministic 500 — never leak internal error details to the caller.
      return new Response(
        JSON.stringify({ error: 'internal_error' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } },
      );
    }
  };
}
