import { uiCopy } from '../constants/uiCopy';

/** Maps `add_model_to_project` RPC error text to user-facing copy. Legacy DB errors (e.g. pre-20260526 connection guard) fall through to generic. */
export function mapAddModelToProjectErrorMessage(raw: string | undefined): string {
  const m = (raw ?? '').toLowerCase();
  if (m.includes('project does not belong')) return uiCopy.projects.addToProjectWrongOrg;
  if (m.includes('not a member of the specified client organization')) {
    return uiCopy.projects.addToProjectNotOrgMember;
  }
  if (m.includes('caller has no client organization')) return uiCopy.projects.addToProjectNoClientOrg;
  if (m.includes('model has no agency') || m.includes('does not exist')) {
    return uiCopy.projects.addToProjectModelNoAgency;
  }
  return uiCopy.projects.addToProjectGeneric;
}
