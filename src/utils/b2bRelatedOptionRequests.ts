/**
 * Filters option requests that belong to a Client↔Agency B2B org-chat conversation.
 * Dedupes by option_request id only — never by conversation or model slot.
 */

export type B2bRelatedOptionRequestSummary = {
  id: string;
  modelName: string;
  date: string;
  requestType?: 'option' | 'casting';
  finalStatus?: string;
  status: string;
};

type RelatedOptionRequestSource = {
  id: string;
  modelName: string;
  date: string;
  requestType?: 'option' | 'casting';
  finalStatus?: string;
  status: string;
  clientOrganizationId?: string;
  agencyOrganizationId?: string;
  isAgencyOnly?: boolean;
};

export function filterRelatedOptionRequestsForB2BConversation(
  requests: ReadonlyArray<RelatedOptionRequestSource>,
  clientOrganizationId: string | null | undefined,
  agencyOrganizationId: string | null | undefined,
): B2bRelatedOptionRequestSummary[] {
  const clientOrg = clientOrganizationId?.trim();
  const agencyOrg = agencyOrganizationId?.trim();
  if (!clientOrg || !agencyOrg) return [];

  const seen = new Set<string>();
  const matched: B2bRelatedOptionRequestSummary[] = [];

  for (const r of requests) {
    if (r.isAgencyOnly) continue;
    if (r.status === 'rejected') continue;
    if (r.clientOrganizationId !== clientOrg) continue;
    if (r.agencyOrganizationId !== agencyOrg) continue;
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    matched.push({
      id: r.id,
      modelName: r.modelName,
      date: r.date,
      requestType: r.requestType,
      finalStatus: r.finalStatus,
      status: r.status,
    });
  }

  matched.sort((a, b) => {
    const dateCmp = b.date.localeCompare(a.date);
    if (dateCmp !== 0) return dateCmp;
    return b.id.localeCompare(a.id);
  });

  return matched;
}

export function relatedRequestCardTitle(
  requestType: 'option' | 'casting' | undefined,
  finalStatus: string | undefined,
): 'option' | 'casting' | 'job' {
  if (finalStatus === 'job_confirmed') return 'job';
  if (requestType === 'casting') return 'casting';
  return 'option';
}
