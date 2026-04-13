import type { ModelAgencyContext as ModelAgencyRow } from '../services/modelsSupabase';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Stable key for one MAT row: same agency may appear multiple times with different territories. */
export function makeModelAgencyKey(agencyId: string, territory: string): string {
  return `${agencyId}:${territory.trim()}`;
}

export function parseModelAgencyKey(key: string): { agencyId: string; territory: string } | null {
  const idx = key.indexOf(':');
  if (idx <= 0 || idx >= key.length - 1) return null;
  const agencyId = key.slice(0, idx);
  const territory = key.slice(idx + 1);
  if (!UUID_RE.test(agencyId)) return null;
  if (!territory) return null;
  return { agencyId, territory };
}

/**
 * Resolves AsyncStorage value: composite `agencyId:territory`, or legacy plain `agencyId` UUID
 * (only unambiguous when exactly one MAT row exists for that agency).
 */
export function resolveStoredRepresentationKey(
  stored: string | null,
  rows: ModelAgencyRow[],
): string | null {
  if (!stored) return null;

  const parsed = parseModelAgencyKey(stored);
  if (parsed) {
    const hit = rows.find(
      (r) => r.agencyId === parsed.agencyId && r.territory === parsed.territory,
    );
    return hit ? makeModelAgencyKey(hit.agencyId, hit.territory) : null;
  }

  if (UUID_RE.test(stored)) {
    const matches = rows.filter((r) => r.agencyId === stored);
    if (matches.length === 1) {
      return makeModelAgencyKey(matches[0].agencyId, matches[0].territory);
    }
    return null;
  }

  return null;
}

export function findRowByKey(rows: ModelAgencyRow[], key: string | null): ModelAgencyRow | null {
  if (!key) return null;
  const p = parseModelAgencyKey(key);
  if (!p) return null;
  return rows.find((r) => r.agencyId === p.agencyId && r.territory === p.territory) ?? null;
}
