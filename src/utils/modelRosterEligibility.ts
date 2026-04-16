/**
 * Agency roster: inclusion requires an active representation row in
 * `model_agency_territories` for this agency (MAT is source of truth).
 * Do not use `models.agency_id` or `user_id` alone — removed / ended representation
 * clears MAT; linked accounts must not reappear without MAT.
 */
export function modelEligibleForAgencyRoster(
  model: { id: string; user_id?: string | null },
  matModelIdsForAgency: Set<string>,
): boolean {
  return matModelIdsForAgency.has(model.id);
}
