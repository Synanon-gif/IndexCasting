/**
 * Filters option requests that belong to a Client↔Agency B2B org-chat conversation.
 * Dedupes by option_request id only — never by conversation or model slot.
 */

import {
  optionRequestWorkflowBadge,
  type OptionRequestWorkflowBadge,
} from './negotiationWorkflowLabel';

export type B2bRelatedOptionRequestSummary = {
  id: string;
  modelName: string;
  date: string;
  requestType?: 'option' | 'casting';
  finalStatus?: string;
  status: string;
  proposedPrice?: number;
  agencyCounterPrice?: number;
  clientPriceStatus?: 'pending' | 'accepted' | 'rejected';
};

type RelatedOptionRequestSource = {
  id: string;
  modelName: string;
  date: string;
  requestType?: 'option' | 'casting';
  finalStatus?: string;
  status: string;
  proposedPrice?: number;
  agencyCounterPrice?: number;
  clientPriceStatus?: 'pending' | 'accepted' | 'rejected';
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
      proposedPrice: r.proposedPrice,
      agencyCounterPrice: r.agencyCounterPrice,
      clientPriceStatus: r.clientPriceStatus,
    });
  }

  matched.sort((a, b) => {
    const dateCmp = b.date.localeCompare(a.date);
    if (dateCmp !== 0) return dateCmp;
    return b.id.localeCompare(a.id);
  });

  return matched;
}

/** Workflow badge for inline B2B org-chat related-request cards — same source as negotiation UI. */
export function relatedOptionRequestWorkflowBadge(
  req: Pick<
    B2bRelatedOptionRequestSummary,
    'status' | 'finalStatus' | 'proposedPrice' | 'agencyCounterPrice' | 'clientPriceStatus'
  >,
): OptionRequestWorkflowBadge {
  return optionRequestWorkflowBadge(req.status, req.finalStatus ?? null, {
    clientPriceStatus: req.clientPriceStatus ?? null,
    agencyCounterPrice: req.agencyCounterPrice ?? null,
    proposedPrice: req.proposedPrice ?? null,
  });
}

export function relatedRequestCardTitle(
  requestType: 'option' | 'casting' | undefined,
  finalStatus: string | undefined,
): 'option' | 'casting' | 'job' {
  if (finalStatus === 'job_confirmed') return 'job';
  if (requestType === 'casting') return 'casting';
  return 'option';
}

export type B2bOrgChatMessageTimelineSource = {
  id: string;
  created_at: string;
  message_type?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type B2bOrgChatTimelineEntry<T extends B2bOrgChatMessageTimelineSource> =
  | { kind: 'message'; message: T }
  | { kind: 'related_request'; request: B2bRelatedOptionRequestSummary };

function timelineSortKeyForRelatedRequest(date: string): number {
  const trimmed = date.trim();
  if (!trimmed) return 0;
  const parsed = Date.parse(`${trimmed}T12:00:00.000Z`);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Merges B2B chat messages with related option requests that have no booking card
 * message yet. Result is chronological (ascending) for inline thread rendering.
 */
export function buildB2bOrgChatTimeline<T extends B2bOrgChatMessageTimelineSource>(
  messages: ReadonlyArray<T>,
  relatedRequests: ReadonlyArray<B2bRelatedOptionRequestSummary>,
): Array<B2bOrgChatTimelineEntry<T>> {
  const coveredOptionRequestIds = new Set<string>();
  for (const m of messages) {
    if (m.message_type !== 'booking') continue;
    const optionRequestId = m.metadata?.option_request_id;
    if (typeof optionRequestId === 'string' && optionRequestId.trim()) {
      coveredOptionRequestIds.add(optionRequestId.trim());
    }
  }

  const orphans = relatedRequests.filter((r) => !coveredOptionRequestIds.has(r.id));

  type Sortable = { sortKey: number; tieBreaker: string; entry: B2bOrgChatTimelineEntry<T> };
  const sortable: Sortable[] = [];

  for (const m of messages) {
    const sortKey = Date.parse(m.created_at);
    sortable.push({
      sortKey: Number.isFinite(sortKey) ? sortKey : 0,
      tieBreaker: m.id,
      entry: { kind: 'message', message: m },
    });
  }

  for (const r of orphans) {
    sortable.push({
      sortKey: timelineSortKeyForRelatedRequest(r.date),
      tieBreaker: r.id,
      entry: { kind: 'related_request', request: r },
    });
  }

  sortable.sort((a, b) => {
    if (a.sortKey !== b.sortKey) return a.sortKey - b.sortKey;
    return a.tieBreaker.localeCompare(b.tieBreaker);
  });

  return sortable.map((s) => s.entry);
}
