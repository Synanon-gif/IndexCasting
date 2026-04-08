/** Bounds only — matches ClientMeasurementFilters chest fields. */
export type ChestFilterBounds = {
  chestMin?: number;
  chestMax?: number;
};

/**
 * Chest min/max using COALESCE(chest, bust) — matches `filterModels` and discovery RPCs.
 * PostgREST cannot express this on `.from('models')`; applied after fetch for legacy paths.
 */
export function filterModelsByChestCoalesce<
  T extends { chest?: number | null; bust?: number | null },
>(models: T[], f: ChestFilterBounds): T[] {
  const hasMin = f.chestMin != null;
  const hasMax = f.chestMax != null;
  if (!hasMin && !hasMax) return models;
  const minV = f.chestMin as number;
  const maxV = f.chestMax as number;
  return models.filter((m) => {
    const v = m.chest ?? m.bust;
    if (hasMin && (v == null || v < minV)) return false;
    if (hasMax && (v == null || v > maxV)) return false;
    return true;
  });
}
