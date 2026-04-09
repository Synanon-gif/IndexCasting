/**
 * Canonical user-facing city for models (client Discover, projects, packages, swipe, guest).
 * Matches DB/RPC: COALESCE(model_locations.city [live>current>agency], models.city).
 * Prefer `effective_city` from discovery/guest RPCs or batched location reads; then joined
 * `location_city` (e.g. get_models_near_location); then `models.city` fallback.
 */
export function canonicalDisplayCityForModel(m: {
  effective_city?: string | null;
  city?: string | null;
  location_city?: string | null;
}): string {
  const eff = (m.effective_city ?? '').trim();
  if (eff) return eff;
  const loc = (m.location_city ?? '').trim();
  if (loc) return loc;
  return (m.city ?? '').trim();
}
