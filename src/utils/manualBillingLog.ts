/**
 * Safe logging for manual billing services — never log row payloads, bank
 * fields, or full error bodies that might echo user data.
 */

function safeErrMessage(err: unknown): string {
  if (err == null) return 'unknown';
  if (typeof err === 'string') return 'string_error';
  if (typeof err !== 'object') return typeof err;
  const o = err as { message?: unknown; code?: unknown; details?: unknown };
  const code = typeof o.code === 'string' ? o.code : '';
  const msg = typeof o.message === 'string' ? o.message.slice(0, 120) : '';
  if (code && msg) return `${code}:${msg}`;
  if (code) return code;
  if (msg) return msg;
  return 'object_error';
}

export function logManualBillingWarning(context: string, err?: unknown): void {
  if (err !== undefined) {
    console.warn(`[manualBilling] ${context}: ${safeErrMessage(err)}`);
  } else {
    console.warn(`[manualBilling] ${context}`);
  }
}
