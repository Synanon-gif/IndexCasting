import type { OptionRequest } from '../store/optionRequests';
import type { Conversation } from '../services/messengerSupabase';
import type { ClientAssignmentFlag } from '../services/clientAssignmentsSupabase';

export type ThreadCounterparty = {
  id: string;
  label: string;
};

const INTERNAL_EVENTS_KEY = '__agency_internal__';
const INTERNAL_EVENTS_LABEL = 'Internal events';

/**
 * Extract unique counterparties from option requests for the filter UI.
 * Agency view: groups by client org / client name. Agency-only requests
 * are grouped under a single "Internal events" bucket.
 * Client view: groups by agency org / agency id.
 */
export function extractCounterparties(
  requests: OptionRequest[],
  role: 'agency' | 'client',
): ThreadCounterparty[] {
  const map = new Map<string, string>();
  for (const r of requests) {
    if (role === 'agency') {
      if (r.isAgencyOnly) {
        if (!map.has(INTERNAL_EVENTS_KEY)) {
          map.set(INTERNAL_EVENTS_KEY, INTERNAL_EVENTS_LABEL);
        }
        continue;
      }
      const key = r.clientOrganizationId ?? r.clientName ?? '';
      if (key && !map.has(key)) {
        map.set(key, r.clientOrganizationName ?? r.clientName ?? 'Client');
      }
    } else {
      const key = r.agencyOrganizationId ?? r.agencyId ?? '';
      if (key && !map.has(key)) {
        map.set(key, key);
      }
    }
  }
  return Array.from(map.entries())
    .map(([id, label]) => ({ id, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Extract unique client org counterparties from BOTH option requests AND B2B conversations.
 * Produces a unified list for the ClientOrgFilterDropdown.
 */
export function extractUnifiedClientOrgs(
  requests: OptionRequest[],
  b2bConversations: Conversation[],
  assignmentByClientOrgId: Record<string, ClientAssignmentFlag>,
): { id: string; label: string; assignment?: ClientAssignmentFlag; threadCount: number }[] {
  const map = new Map<string, { label: string; count: number }>();
  for (const r of requests) {
    if (r.isAgencyOnly) continue;
    const key = r.clientOrganizationId ?? '';
    if (!key) continue;
    const existing = map.get(key);
    if (existing) {
      existing.count++;
    } else {
      map.set(key, {
        label: r.clientOrganizationName ?? r.clientName ?? 'Client',
        count: 1,
      });
    }
  }
  for (const c of b2bConversations) {
    const key = c.client_organization_id ?? '';
    if (!key) continue;
    const existing = map.get(key);
    if (existing) {
      existing.count++;
    } else {
      map.set(key, { label: c.title ?? 'Client', count: 1 });
    }
  }
  return Array.from(map.entries())
    .map(([id, { label, count }]) => ({
      id,
      label,
      assignment: assignmentByClientOrgId[id],
      threadCount: count,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Filter requests by selected counterparty id.
 */
export function filterByCounterparty(
  requests: OptionRequest[],
  role: 'agency' | 'client',
  counterpartyId: string | null,
): OptionRequest[] {
  if (!counterpartyId) return requests;
  return requests.filter((r) => {
    if (role === 'agency') {
      return (r.clientOrganizationId ?? r.clientName ?? '') === counterpartyId;
    }
    return (r.agencyOrganizationId ?? r.agencyId ?? '') === counterpartyId;
  });
}

/**
 * Filter B2B conversations by client organization id.
 */
export function filterB2BByClientOrg(
  conversations: Conversation[],
  clientOrgId: string | null,
): Conversation[] {
  if (!clientOrgId) return conversations;
  return conversations.filter((c) => c.client_organization_id === clientOrgId);
}

/**
 * Apply the unified dropdown filter (including __mine__ / __unassigned__ meta-keys)
 * to option requests. Returns the filtered list.
 */
export function applyUnifiedOrgFilter(
  requests: OptionRequest[],
  filterId: string | null,
  assignmentByClientOrgId: Record<string, ClientAssignmentFlag>,
  currentUserId: string | null,
): OptionRequest[] {
  if (!filterId) return requests;
  if (filterId === '__mine__') {
    return requests.filter((r) => {
      const a = r.clientOrganizationId
        ? assignmentByClientOrgId[r.clientOrganizationId]
        : undefined;
      return a?.assignedMemberUserId === currentUserId;
    });
  }
  if (filterId === '__unassigned__') {
    return requests.filter((r) => {
      const a = r.clientOrganizationId
        ? assignmentByClientOrgId[r.clientOrganizationId]
        : undefined;
      return !a?.assignedMemberUserId;
    });
  }
  if (filterId === INTERNAL_EVENTS_KEY) {
    return requests.filter((r) => r.isAgencyOnly);
  }
  return requests.filter((r) => {
    if (r.isAgencyOnly) return false;
    return (r.clientOrganizationId ?? r.clientName ?? '') === filterId;
  });
}

/**
 * Apply the unified dropdown filter to B2B conversations.
 */
export function applyUnifiedOrgFilterToB2B(
  conversations: Conversation[],
  filterId: string | null,
  assignmentByClientOrgId: Record<string, ClientAssignmentFlag>,
  currentUserId: string | null,
): Conversation[] {
  if (!filterId) return conversations;
  if (filterId === '__mine__') {
    return conversations.filter((c) => {
      const a = c.client_organization_id
        ? assignmentByClientOrgId[c.client_organization_id]
        : undefined;
      return a?.assignedMemberUserId === currentUserId;
    });
  }
  if (filterId === '__unassigned__') {
    return conversations.filter((c) => {
      const a = c.client_organization_id
        ? assignmentByClientOrgId[c.client_organization_id]
        : undefined;
      return !a?.assignedMemberUserId;
    });
  }
  if (filterId === INTERNAL_EVENTS_KEY) {
    return [];
  }
  return conversations.filter((c) => c.client_organization_id === filterId);
}
