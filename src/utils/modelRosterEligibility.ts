/**
 * Agency roster: inclusion requires an active representation row in
 * `model_agency_territories` for this agency (MAT is source of truth).
 * Do not use `models.agency_id` or `user_id` alone — removed / ended representation
 * clears MAT; linked accounts must not reappear without MAT.
 *
 * Defense-in-depth: if `agency_relationship_status = 'ended'`, exclude even if MAT
 * rows were inconsistent (representation must never show as active roster).
 */
export function modelEligibleForAgencyRoster(
  model: { id: string; user_id?: string | null; agency_relationship_status?: string | null },
  matModelIdsForAgency: Set<string>,
): boolean {
  if (model.agency_relationship_status === 'ended') {
    return false;
  }
  return matModelIdsForAgency.has(model.id);
}
