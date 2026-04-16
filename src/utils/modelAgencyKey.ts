import type { ModelAgencyContext as ModelAgencyRow } from '../services/modelsSupabase';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One representation key per agency (`agencies.id`) — not per territory. */
export function makeModelAgencyKey(agencyId: string): string {
  return agencyId.trim();
}

export function parseModelAgencyKey(
  key: string,
): { agencyId: string; territoryLegacy?: string } | null {
  if (!key || typeof key !== 'string') return null;
  const trimmed = key.trim();
  if (UUID_RE.test(trimmed)) {
    return { agencyId: trimmed };
  }
  const idx = trimmed.indexOf(':');
  if (idx <= 0 || idx >= trimmed.length - 1) return null;
  const agencyId = trimmed.slice(0, idx);
  const territoryLegacy = trimmed.slice(idx + 1);
  if (!UUID_RE.test(agencyId)) return null;
  return { agencyId, territoryLegacy: territoryLegacy || undefined };
}

/**
 * Resolves AsyncStorage: canonical agency UUID, or legacy `agencyId:territory` (migrated to agency UUID).
 */
export function resolveStoredRepresentationKey(
  stored: string | null,
  rows: ModelAgencyRow[],
): string | null {
  if (!stored) return null;

  const parsed = parseModelAgencyKey(stored);
  if (parsed) {
    const hit = rows.find((r) => r.agencyId === parsed.agencyId);
    return hit ? makeModelAgencyKey(hit.agencyId) : null;
  }

  return null;
}

export function findRowByKey(rows: ModelAgencyRow[], key: string | null): ModelAgencyRow | null {
  if (!key) return null;
  const p = parseModelAgencyKey(key);
  if (!p) return null;
  return rows.find((r) => r.agencyId === p.agencyId) ?? null;
}

/** Distinct agencies (rows are already aggregated one-per-agency from getMyModelAgencies). */
export function countUniqueAgencyIds(rows: ModelAgencyRow[]): number {
  return new Set(rows.map((r) => r.agencyId)).size;
}

export function canonicalMatRowForAgency(
  rows: ModelAgencyRow[],
  agencyId: string,
): ModelAgencyRow | null {
  return rows.find((r) => r.agencyId === agencyId) ?? null;
}

/** One row per agency — list is pre-aggregated; sort for stable UI. */
export function uniqueAgencyRowsForSwitcher(rows: ModelAgencyRow[]): ModelAgencyRow[] {
  return rows
    .slice()
    .sort(
      (a, b) => a.agencyName.localeCompare(b.agencyName) || a.agencyId.localeCompare(b.agencyId),
    );
}

/**
 * True when the model has more than one distinct agency — user must pick (routing + settings).
 * MUST stay aligned with `computeInitialRepresentationKey` (multi-agency → null until chosen).
 */
export function needsAgencySelectionUi(rows: ModelAgencyRow[]): boolean {
  return countUniqueAgencyIds(rows) > 1;
}

/**
 * Initial representation key after load — agency UUID.
 * (1) valid stored key, (2) exactly one agency → that agency, (3) multiple agencies or empty → null.
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
    return canonical ? makeModelAgencyKey(canonical.agencyId) : null;
  }
  return null;
}
