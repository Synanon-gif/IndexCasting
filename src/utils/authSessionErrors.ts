/**
 * Normalized detection for Supabase Auth API errors where the local JWT
 * references a session that no longer exists server-side (stale refresh/storage).
 */

export function isSessionNotFoundError(error: unknown): boolean {
  if (error == null || typeof error !== 'object') return false;
  const o = error as Record<string, unknown>;
  const msg = typeof o.message === 'string' ? o.message : String(o.message ?? '');
  if (msg.toLowerCase().includes('session_not_found')) return true;
  if (o.code === 'session_not_found') return true;
  return false;
}
