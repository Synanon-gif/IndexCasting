/**
 * Client-side bounds for URL query tokens and shared-link params.
 * Prevents localStorage / memory abuse from megabyte query strings; does not replace server validation.
 */

/** Invite / model_invite tokens (JWT-like); generous headroom for provider formats. */
export const INVITE_OR_CLAIM_TOKEN_MAX_LEN = 16384;

/** Generic UUID or id segment in query strings. */
export const QUERY_ID_MAX_LEN = 128;

export const SHARED_SELECTION_NAME_MAX_LEN = 256;
export const SHARED_SELECTION_IDS_MAX_COUNT = 500;

export function clampInviteOrClaimToken(token: string | null | undefined): string | null {
  if (token == null) return null;
  const t = token.trim();
  if (!t) return null;
  if (t.length > INVITE_OR_CLAIM_TOKEN_MAX_LEN) return null;
  return t;
}

export function clampQueryId(id: string | null | undefined): string | null {
  if (id == null) return null;
  const t = id.trim();
  if (!t) return null;
  if (t.length > QUERY_ID_MAX_LEN) return null;
  return t;
}

/**
 * Parses ?shared=1&name=&ids= for SharedSelectionView; caps size to avoid UI / URL abuse.
 */
export function parseSharedSelectionParams(p: URLSearchParams): { name: string; ids: string[] } | null {
  if (p.get('shared') !== '1') return null;
  const rawName = p.get('name') || 'Selection';
  const name =
    rawName.length > SHARED_SELECTION_NAME_MAX_LEN ? rawName.slice(0, SHARED_SELECTION_NAME_MAX_LEN) : rawName;
  const rawIds = (p.get('ids') || '').split(',').filter(Boolean);
  const ids = rawIds
    .slice(0, SHARED_SELECTION_IDS_MAX_COUNT)
    .map((id) => id.trim())
    .filter((id) => id.length > 0 && id.length <= QUERY_ID_MAX_LEN);
  return { name, ids };
}
