/**
 * Pure helper functions for org profile screens — Phase 2A.
 * Kept separate from React Native code so they can be unit-tested cleanly.
 */

import type { SupabaseModel } from '../services/modelsSupabase';

export type ModelSegment = 'women' | 'men' | 'all';

/**
 * Filter models by Women/Men/All segment and sort alphabetically by name.
 * Models with null sex appear only under "all" (same as public agency profile).
 * Does not mutate the input array.
 */
export function filterAndSortModelsBySegment(
  models: SupabaseModel[],
  segment: ModelSegment,
): SupabaseModel[] {
  const filtered =
    segment === 'all'
      ? models
      : models.filter((m) => (segment === 'women' ? m.sex === 'female' : m.sex === 'male'));
  return [...filtered].sort((a, b) => a.name.localeCompare(b.name));
}
