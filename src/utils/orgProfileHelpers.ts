/**
 * Pure helper functions for org profile screens — Phase 2A.
 * Kept separate from React Native code so they can be unit-tested cleanly.
 */

import type { SupabaseModel } from '../services/modelsSupabase';

export type ModelSegment = 'women' | 'men';

/**
 * Filter models by Women/Men segment and sort alphabetically by name.
 * Models with null sex are excluded from both segments.
 * Does not mutate the input array.
 */
export function filterAndSortModelsBySegment(
  models: SupabaseModel[],
  segment: ModelSegment,
): SupabaseModel[] {
  return models
    .filter((m) => (segment === 'women' ? m.sex === 'female' : m.sex === 'male'))
    .sort((a, b) => a.name.localeCompare(b.name));
}
