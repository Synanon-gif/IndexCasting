/**
 * Read-only invariant checks for dev/test. No mutations, no production side effects
 * except optional console warn/error when runtime is dev (__DEV__ or NODE_ENV=development).
 *
 * Stable grep prefixes: [roster][integrity] [calendar][dedupe] [chat][mat] [location][priority]
 * [application][link] [org][dissolve]
 */
import { modelEligibleForAgencyRoster } from './modelRosterEligibility';

/** Canonical merge order (lowest wins) — align with system-invariants / audit report. */
export const CALENDAR_CANONICAL_MERGE_ORDER = [
  'booking_events',
  'calendar_entries_booking',
  'calendar_entries_option_casting',
  'user_calendar_events_mirrored',
  'user_calendar_events_manual',
] as const;

export type CalendarCanonicalMergeLayer = (typeof CALENDAR_CANONICAL_MERGE_ORDER)[number];

export function invariantDevRuntime(): boolean {
  try {
    if (typeof __DEV__ !== 'undefined' && __DEV__) return true;
    if (typeof process !== 'undefined' && process.env.NODE_ENV === 'development') return true;
    return false;
  } catch {
    return false;
  }
}

export function logInvariantDev(
  level: 'warn' | 'error',
  channel: 'roster' | 'calendar' | 'chat' | 'location' | 'application' | 'org',
  sub: 'integrity' | 'dedupe' | 'mat' | 'priority' | 'link' | 'dissolve',
  message: string,
  payload?: Record<string, unknown>,
): void {
  if (!invariantDevRuntime()) return;
  const prefix = `[${channel}][${sub}]`;
  const line = `${prefix} ${message}`;
  if (level === 'error') {
    console.error(line, payload ?? {});
  } else {
    console.warn(line, payload ?? {});
  }
}

/** Pure: roster rows that are not in the MAT id set (should be empty after filter). */
export function validateRosterMatMembershipIssues(
  models: Array<{ id: string }>,
  matModelIdsForAgency: Set<string>,
): Array<{ modelId: string; code: 'missing_mat' }> {
  const issues: Array<{ modelId: string; code: 'missing_mat' }> = [];
  for (const m of models) {
    if (!matModelIdsForAgency.has(m.id)) {
      issues.push({ modelId: m.id, code: 'missing_mat' });
    }
  }
  return issues;
}

/**
 * Pure: same option_request_id, non-cancelled, multiple rows — indicates pre-dedupe drift.
 */
export function findDuplicateActiveCalendarEntriesByOptionRequestDev(
  entries: Array<{
    id?: string;
    option_request_id?: string | null;
    status?: string | null;
  }>,
): Array<{ optionRequestId: string; entryIds: string[] }> {
  const map = new Map<string, string[]>();
  for (const e of entries) {
    const oid = (e.option_request_id ?? '').trim();
    if (!oid) continue;
    if ((e.status ?? '').toLowerCase() === 'cancelled') continue;
    const id = (e.id ?? '').trim() || '?';
    const list = map.get(oid) ?? [];
    list.push(id);
    map.set(oid, list);
  }
  return [...map.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([optionRequestId, entryIds]) => ({ optionRequestId, entryIds }));
}

/**
 * Pure: UI should not list the same (modelId, agencyId) pair twice (multi-territory = one relationship).
 */
export function validateAgencyAggregationDuplicatesDev(
  rows: Array<{ modelId: string; agencyId: string }>,
): Array<{ modelId: string; agencyId: string; count: number }> {
  const keyCount = new Map<string, number>();
  for (const r of rows) {
    const k = `${r.modelId.trim()}|${r.agencyId.trim()}`;
    keyCount.set(k, (keyCount.get(k) ?? 0) + 1);
  }
  const out: Array<{ modelId: string; agencyId: string; count: number }> = [];
  for (const [k, count] of keyCount) {
    if (count <= 1) continue;
    const [modelId, agencyId] = k.split('|');
    out.push({ modelId, agencyId, count });
  }
  return out;
}

/**
 * Pure: when effective_city is present, display paths should prefer it over raw models.city (drift hint).
 */
export function validateLocationDisplayDriftHintDev(model: {
  id?: string;
  effective_city?: string | null;
  city?: string | null;
}): { drift: boolean; reason?: string } {
  const eff = (model.effective_city ?? '').trim().toLowerCase();
  const city = (model.city ?? '').trim().toLowerCase();
  if (!eff || !city) return { drift: false };
  if (eff === city) return { drift: false };
  if (eff.includes(city) || city.includes(eff)) return { drift: false };
  return {
    drift: true,
    reason:
      'effective_city and models.city differ — ensure UI uses canonicalDisplayCityForModel / effective_city',
  };
}

/** Dev-only: roster rows must satisfy canonical eligibility when MAT lookup succeeded. */
export function devAssertAgencyRosterMatchesEligibility(
  models: Array<{ id: string; user_id: string | null }>,
  matModelIdsForAgency: Set<string>,
  agencyId: string,
  matLookupOk: boolean,
): void {
  if (!invariantDevRuntime() || !matLookupOk || !agencyId?.trim()) return;
  for (const m of models) {
    if (!modelEligibleForAgencyRoster(m, matModelIdsForAgency)) {
      logInvariantDev('error', 'roster', 'integrity', 'row violates modelEligibleForAgencyRoster', {
        agencyId,
        modelId: m.id,
        path: 'devAssertAgencyRosterMatchesEligibility',
      });
    }
  }
}

/** Dev-only: log when multiple active calendar rows share option_request_id before merge. */
export function logCalendarPreDedupeIfDuplicatesDev(
  entries: Array<{
    id?: string;
    option_request_id?: string | null;
    status?: string | null;
  }>,
  path: string,
): void {
  if (!invariantDevRuntime()) return;
  const dups = findDuplicateActiveCalendarEntriesByOptionRequestDev(entries);
  if (dups.length === 0) return;
  logInvariantDev(
    'warn',
    'calendar',
    'dedupe',
    'multiple active calendar rows for same option_request_id',
    {
      path,
      duplicateGroups: dups.slice(0, 12),
      totalGroups: dups.length,
    },
  );
}
