/**
 * Normalized detection for Supabase Auth API errors where the local JWT
 * references a session that no longer exists server-side (stale refresh/storage).
 */

function normalizedAuthErrorMessage(error: unknown): string {
  if (error == null) return '';
  if (typeof error === 'string') return error.toLowerCase();
  if (error instanceof Error) return error.message.toLowerCase();
  if (typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message ?? '').toLowerCase();
  }
  return String(error).toLowerCase();
}

export function isSessionNotFoundError(error: unknown): boolean {
  if (error == null || typeof error !== 'object') return false;
  const o = error as Record<string, unknown>;
  const msg = typeof o.message === 'string' ? o.message : String(o.message ?? '');
  if (msg.toLowerCase().includes('session_not_found')) return true;
  if (o.code === 'session_not_found') return true;
  return false;
}

/**
 * Refresh token revoked server-side, local storage out of sync, or session
 * garbage-collected — same recovery as session_not_found (clear local session).
 */
export function isInvalidRefreshTokenError(error: unknown): boolean {
  const m = normalizedAuthErrorMessage(error);
  if (!m) return false;
  if (m.includes('invalid refresh token')) return true;
  if (m.includes('refresh token not found')) return true;
  return false;
}

/** Use before bootstrap / profile loads when getUser() fails — avoids boot loops on dead sessions. */
export function shouldClearStaleLocalSession(error: unknown): boolean {
  return isSessionNotFoundError(error) || isInvalidRefreshTokenError(error);
}
