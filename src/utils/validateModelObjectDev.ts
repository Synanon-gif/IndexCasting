import { modelEligibleForAgencyRoster } from './modelRosterEligibility';

function isDevRuntime(): boolean {
  if (typeof __DEV__ !== 'undefined' && __DEV__) return true;
  if (typeof process !== 'undefined' && process.env.NODE_ENV === 'development') return true;
  return false;
}

/** Dev-only: roster rows must satisfy canonical eligibility when MAT lookup succeeded. */
export function devAssertAgencyRosterMatchesEligibility(
  models: Array<{ id: string; user_id: string | null }>,
  matModelIdsForAgency: Set<string>,
  agencyId: string,
  matLookupOk: boolean,
): void {
  if (!isDevRuntime() || !matLookupOk || !agencyId?.trim()) return;
  for (const m of models) {
    if (!modelEligibleForAgencyRoster(m, matModelIdsForAgency)) {
      console.error('[dev] agency roster row violates modelEligibleForAgencyRoster', {
        agencyId,
        modelId: m.id,
      });
    }
  }
}
