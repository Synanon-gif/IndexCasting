/**
 * Re-exports — canonical implementation: `invariantValidationDev.ts`.
 */
export {
  CALENDAR_CANONICAL_MERGE_ORDER,
  devAssertAgencyRosterMatchesEligibility,
  findDuplicateActiveCalendarEntriesByOptionRequestDev,
  invariantDevRuntime,
  logCalendarPreDedupeIfDuplicatesDev,
  logInvariantDev,
  validateAgencyAggregationDuplicatesDev,
  validateLocationDisplayDriftHintDev,
  validateRosterMatMembershipIssues,
} from './invariantValidationDev';
export type { CalendarCanonicalMergeLayer } from './invariantValidationDev';
