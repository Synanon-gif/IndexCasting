import type { OptionRequest } from '../store/optionRequests';
import { uiCopy } from '../constants/uiCopy';

const MAX_JOB_SNIPPET = 140;

/**
 * Lifecycle-aware short label ("Option" / "Casting" / "Job") for any UI surface
 * that previously hard-coded the request type.
 *
 * Invariant (system-invariants.mdc — Negotiation/Confirmation §I, Calendar §G):
 *   Once `final_status === 'job_confirmed'` the lifecycle is a JOB, regardless
 *   of `request_type`. Showing "Option" for a confirmed job is a regression
 *   the user explicitly called out.
 */
export function lifecycleLabelForRequest(input: {
  requestType?: string | null;
  finalStatus?: string | null;
}): string {
  if (input.finalStatus === 'job_confirmed') return uiCopy.dashboard.threadContextJob;
  if (input.requestType === 'casting') return uiCopy.dashboard.threadContextCasting;
  return uiCopy.dashboard.threadContextOption;
}

/** Minimal fields for counterparty title (DB rows or store entities). */
export type ModelCounterpartyLabelInput = {
  isAgencyOnly?: boolean;
  agencyOrganizationName?: string | null;
  clientOrganizationName?: string | null;
  clientName?: string | null;
};

// Generic role labels that legacy data sometimes stored in client_name as a
// stub ("Client", "Agency", "Model"). They MUST be treated as placeholders and
// must never be displayed as if they were a real organization name.
const PLACEHOLDER_NAMES = new Set(['client', 'agency', 'model']);

function sanitizeName(value?: string | null): string {
  const t = value?.trim();
  if (!t) return '';
  if (PLACEHOLDER_NAMES.has(t.toLowerCase())) return '';
  return t;
}

/**
 * Build the combined model-facing counterparty label.
 *
 * Product invariant (system-invariants.mdc §27.x — Organization Identity):
 *   - For client-driven flows, the model MUST see the real client organization
 *     name AND the agency that created the event ("Client Org · via Agency Org").
 *     A model can have multiple agencies (one per territory), so showing the
 *     originating agency is required context.
 *   - For agency-only flows (no client), only the agency name is shown.
 *   - Generic placeholders ("Client", "Agency", "Model") are NEVER returned;
 *     legacy client_name stubs holding those values are filtered out.
 */
function counterpartyLabelFromFields(req: ModelCounterpartyLabelInput): string {
  const clientOrg = sanitizeName(req.clientOrganizationName);
  const agencyOrg = sanitizeName(req.agencyOrganizationName);
  const legacyClientName = sanitizeName(req.clientName);

  if (req.isAgencyOnly) {
    return agencyOrg || clientOrg || legacyClientName || uiCopy.common.unknownAgency;
  }

  const clientLabel = clientOrg || legacyClientName;
  if (clientLabel && agencyOrg && clientLabel !== agencyOrg) {
    return `${clientLabel} · via ${agencyOrg}`;
  }
  return clientLabel || agencyOrg || uiCopy.common.unknownClient;
}

/**
 * Primary title for model-facing option/casting rows and thread headers.
 * Client-driven: "Client Org · via Agency Org"; agency-only: agency org name.
 */
export function primaryCounterpartyLabelForModel(req: OptionRequest): string {
  return counterpartyLabelFromFields(req);
}

/** Same as {@link primaryCounterpartyLabelForModel} for raw `option_requests` / model-safe SELECT rows. */
export function primaryCounterpartyLabelForModelFromDbRow(r: {
  is_agency_only?: boolean | null;
  agency_organization_name?: string | null;
  client_organization_name?: string | null;
  client_name?: string | null;
}): string {
  return counterpartyLabelFromFields({
    isAgencyOnly: r.is_agency_only ?? false,
    agencyOrganizationName: r.agency_organization_name ?? undefined,
    clientOrganizationName: r.client_organization_name ?? undefined,
    clientName: r.client_name ?? undefined,
  });
}

/**
 * Second line: date and optional truncated role / job description.
 */
export function secondarySubtitleForModel(req: OptionRequest): string {
  const datePart = req.date?.trim() ?? '';
  const jd = req.jobDescription?.trim();
  if (!jd) return datePart;
  const truncated = jd.length > MAX_JOB_SNIPPET ? `${jd.slice(0, MAX_JOB_SNIPPET)}…` : jd;
  if (!datePart) return truncated;
  return `${datePart} · ${truncated}`;
}
