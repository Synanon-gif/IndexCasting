import type { OptionRequest } from '../store/optionRequests';

const MAX_JOB_SNIPPET = 140;

/** Minimal fields for counterparty title (DB rows or store entities). */
export type ModelCounterpartyLabelInput = {
  isAgencyOnly?: boolean;
  agencyOrganizationName?: string | null;
  clientOrganizationName?: string | null;
  clientName?: string | null;
};

function counterpartyLabelFromFields(req: ModelCounterpartyLabelInput): string {
  if (req.isAgencyOnly) {
    const t =
      req.agencyOrganizationName?.trim() ||
      req.clientOrganizationName?.trim() ||
      req.clientName?.trim();
    return t || 'Agency event';
  }
  const t =
    req.clientOrganizationName?.trim() ||
    req.clientName?.trim() ||
    req.agencyOrganizationName?.trim();
  return t || 'Request';
}

/**
 * Primary title for model-facing option/casting rows and thread headers.
 * Client org / client name first for client-driven flows; agency org for agency-only.
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
