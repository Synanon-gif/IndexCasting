/** Agency roster: show row only if linked account OR at least one MAT row for this agency. */
export function modelEligibleForAgencyRoster(
  model: { id: string; user_id: string | null },
  matModelIdsForAgency: Set<string>,
): boolean {
  if (model.user_id) return true;
  return matModelIdsForAgency.has(model.id);
}
