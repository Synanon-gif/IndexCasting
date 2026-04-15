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

/** Distinct agencies (a model may have many MAT rows for the same agency). */
export function countUniqueAgencyIds(rows: ModelAgencyRow[]): number {
  return new Set(rows.map((r) => r.agencyId)).size;
}

/**
 * One stable MAT row per agency for AsyncStorage / switcher (territory tie-break only).
 * Same agency in DE+AT → one canonical row (alphabetically first territory code).
 */
export function canonicalMatRowForAgency(
  rows: ModelAgencyRow[],
  agencyId: string,
): ModelAgencyRow | null {
  const matches = rows.filter((r) => r.agencyId === agencyId);
  if (matches.length === 0) return null;
  return matches.slice().sort((a, b) => a.territory.localeCompare(b.territory))[0];
}

/** One canonical row per distinct agency — for "Switch agency" UI (not per territory). */
export function uniqueAgencyRowsForSwitcher(rows: ModelAgencyRow[]): ModelAgencyRow[] {
  const ids = [...new Set(rows.map((r) => r.agencyId))];
  const canonical = ids
    .map((id) => canonicalMatRowForAgency(rows, id))
    .filter((r): r is ModelAgencyRow => r != null);
  canonical.sort(
    (a, b) => a.agencyName.localeCompare(b.agencyName) || a.agencyId.localeCompare(b.agencyId),
  );
  return canonical;
}

/**
 * True when the model has more than one distinct agency — user must pick (routing + settings).
 * MUST stay aligned with `computeInitialRepresentationKey` (multi-agency → null until chosen).
 */
export function needsAgencySelectionUi(rows: ModelAgencyRow[]): boolean {
  return countUniqueAgencyIds(rows) > 1;
}

/**
 * Initial `agencyId:territory` key after load — single source of truth for `ModelAgencyProvider`.
 * Order: (1) valid stored composite / legacy resolution, (2) exactly one agency → canonical MAT row,
 * (3) multiple agencies or empty → null (caller shows picker or empty state).
 */
export function computeInitialRepresentationKey(
  stored: string | null,
  rows: ModelAgencyRow[],
): string | null {
  const resolved = resolveStoredRepresentationKey(stored, rows);
  if (resolved && findRowByKey(rows, resolved)) {
    return resolved;
  }
  if (rows.length > 0 && countUniqueAgencyIds(rows) === 1) {
    const canonical = canonicalMatRowForAgency(rows, rows[0].agencyId);
    return canonical ? makeModelAgencyKey(canonical.agencyId, canonical.territory) : null;
  }
  return null;
}
