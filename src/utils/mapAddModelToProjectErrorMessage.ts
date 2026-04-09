import { uiCopy } from '../constants/uiCopy';

export type MapAddModelToProjectErrorOpts = {
  /** PostgREST `details` — sometimes holds the Postgres exception text when `message` is generic. */
  details?: string | null;
  hint?: string | null;
  /** e.g. PGRST202 — not mapped to product copy; helps distinguish migration/cache issues. */
  code?: string;
};

function combinedErrorText(raw: string | undefined, opts?: MapAddModelToProjectErrorOpts): string {
  const parts = [raw, opts?.details, opts?.hint].filter(
    (p): p is string => typeof p === 'string' && p.trim().length > 0,
  );
  return parts.join(' ').toLowerCase();
}

/**
 * Maps `add_model_to_project` RPC / PostgREST error text to user-facing copy.
 * Uses `details`/`hint` when present so a generic `message` alone cannot force the wrong label.
 * Legacy connection-guard strings pre-20260526 fall through to generic (never "connect first").
 */
export function mapAddModelToProjectErrorMessage(
  raw: string | undefined,
  opts?: MapAddModelToProjectErrorOpts,
): string {
  const m = combinedErrorText(raw, opts);
  if (m.includes('project does not belong')) return uiCopy.projects.addToProjectWrongOrg;
  if (m.includes('not a member of the specified client organization')) {
    return uiCopy.projects.addToProjectNotOrgMember;
  }
  if (m.includes('caller has no client organization')) return uiCopy.projects.addToProjectNoClientOrg;
  if (m.includes('not_authenticated')) return uiCopy.alerts.signInRequired;
  if (m.includes('model does not exist')) {
    return uiCopy.projects.addToProjectGeneric;
  }
  if (m.includes('model has no agency') || (m.includes('does not exist') && m.includes('model'))) {
    return uiCopy.projects.addToProjectModelNoAgency;
  }
  if (m.includes('does not exist') && (m.includes('project') || m.includes('function'))) {
    return uiCopy.projects.addToProjectGeneric;
  }
  return uiCopy.projects.addToProjectGeneric;
}
