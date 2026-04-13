import type { OptionRequest } from '../store/optionRequests';

const MAX_JOB_SNIPPET = 140;

/**
 * Primary title for model-facing option/casting rows and thread headers.
 * Client org / client name first for client-driven flows; agency org for agency-only.
 */
export function primaryCounterpartyLabelForModel(req: OptionRequest): string {
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
