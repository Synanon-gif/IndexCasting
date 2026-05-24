import { isAgency as checkIsAgency } from '../types/roles';

export type LegalAcceptanceCheckboxState = {
  tosChecked: boolean;
  privacyChecked: boolean;
  agencyRightsChecked: boolean;
};

/** Pure gate: required checkboxes before platform legal accept (Agency includes model-rights). */
export function legalAcceptanceCanSubmit(
  profile: { role?: string } | null | undefined,
  state: LegalAcceptanceCheckboxState,
): boolean {
  const isAgency = checkIsAgency(profile ?? null);
  return state.tosChecked && state.privacyChecked && (!isAgency || state.agencyRightsChecked);
}
