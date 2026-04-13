import {
  extractCounterparties,
  filterByCounterparty,
  extractUnifiedClientOrgs,
  applyUnifiedOrgFilter,
  applyUnifiedOrgFilterToB2B,
} from '../threadFilters';
import type { OptionRequest } from '../../store/optionRequests';
import type { Conversation } from '../../services/messengerSupabase';
import type { ClientAssignmentFlag } from '../../services/clientAssignmentsSupabase';

function makeRequest(overrides: Partial<OptionRequest> = {}): OptionRequest {
  return {
    id: 'req-1',
    clientName: 'Client A',
    clientOrganizationId: 'org-client-1',
    clientOrganizationName: 'Client Org A',
    agencyId: 'agency-1',
    agencyOrganizationId: 'org-agency-1',
    modelName: 'Model X',
    modelId: 'model-1',
    date: '2026-06-01',
    status: 'in_negotiation',
    threadId: 'thread-1',
    createdAt: Date.now(),
    modelApproval: 'pending',
    ...overrides,
  };
}

describe('extractCounterparties', () => {
  it('extracts unique clients for agency role', () => {
    const requests = [
      makeRequest({ clientOrganizationId: 'org-c1', clientOrganizationName: 'Client Org 1' }),
      makeRequest({
        id: 'req-2',
        clientOrganizationId: 'org-c1',
        clientOrganizationName: 'Client Org 1',
        threadId: 'thread-2',
      }),
      makeRequest({
        id: 'req-3',
        clientOrganizationId: 'org-c2',
        clientOrganizationName: 'Client Org 2',
        threadId: 'thread-3',
      }),
    ];
    const result = extractCounterparties(requests, 'agency');
    expect(result).toHaveLength(2);
    expect(result.map((c) => c.id)).toEqual(expect.arrayContaining(['org-c1', 'org-c2']));
  });

  it('falls back to clientName when clientOrganizationId is missing', () => {
    const requests = [
      makeRequest({
        clientOrganizationId: undefined,
        clientOrganizationName: undefined,
        clientName: 'Fallback Client',
      }),
    ];
    const result = extractCounterparties(requests, 'agency');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('Fallback Client');
    expect(result[0].label).toBe('Fallback Client');
  });

  it('extracts unique agencies for client role', () => {
    const requests = [
      makeRequest({ agencyOrganizationId: 'org-a1' }),
      makeRequest({ id: 'req-2', agencyOrganizationId: 'org-a1', threadId: 'thread-2' }),
      makeRequest({ id: 'req-3', agencyOrganizationId: 'org-a2', threadId: 'thread-3' }),
    ];
    const result = extractCounterparties(requests, 'client');
    expect(result).toHaveLength(2);
    expect(result.map((c) => c.id)).toEqual(expect.arrayContaining(['org-a1', 'org-a2']));
  });

  it('returns empty array for empty requests', () => {
    expect(extractCounterparties([], 'agency')).toEqual([]);
    expect(extractCounterparties([], 'client')).toEqual([]);
  });

  it('sorts counterparties by label', () => {
    const requests = [
      makeRequest({ clientOrganizationId: 'org-b', clientOrganizationName: 'Zebra Corp' }),
      makeRequest({
        id: 'r2',
        clientOrganizationId: 'org-a',
        clientOrganizationName: 'Alpha Inc',
        threadId: 't2',
      }),
    ];
    const result = extractCounterparties(requests, 'agency');
    expect(result[0].label).toBe('Alpha Inc');
    expect(result[1].label).toBe('Zebra Corp');
  });
});

describe('filterByCounterparty', () => {
  const requests = [
    makeRequest({ clientOrganizationId: 'org-c1', clientName: 'C1' }),
    makeRequest({ id: 'r2', clientOrganizationId: 'org-c2', clientName: 'C2', threadId: 't2' }),
    makeRequest({ id: 'r3', clientOrganizationId: 'org-c1', clientName: 'C1', threadId: 't3' }),
  ];

  it('returns all when counterpartyId is null', () => {
    const result = filterByCounterparty(requests, 'agency', null);
    expect(result).toHaveLength(3);
  });

  it('filters by clientOrganizationId for agency role', () => {
    const result = filterByCounterparty(requests, 'agency', 'org-c1');
    expect(result).toHaveLength(2);
    expect(result.every((r) => r.clientOrganizationId === 'org-c1')).toBe(true);
  });

  it('filters by agencyOrganizationId for client role', () => {
    const agencyRequests = [
      makeRequest({ agencyOrganizationId: 'org-a1' }),
      makeRequest({ id: 'r2', agencyOrganizationId: 'org-a2', threadId: 't2' }),
    ];
    const result = filterByCounterparty(agencyRequests, 'client', 'org-a1');
    expect(result).toHaveLength(1);
    expect(result[0].agencyOrganizationId).toBe('org-a1');
  });

  it('returns empty if no match', () => {
    const result = filterByCounterparty(requests, 'agency', 'nonexistent');
    expect(result).toHaveLength(0);
  });
});

// ──────────────────────────────────────────────────────────
// Unified filter tests (WS2 — ClientOrgFilterDropdown)
// ──────────────────────────────────────────────────────────

function makeConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 'conv-1',
    type: 'direct',
    context_id: null,
    title: null,
    participant_ids: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    created_by: null,
    client_organization_id: null,
    agency_organization_id: null,
    ...overrides,
  } as Conversation;
}

describe('extractUnifiedClientOrgs', () => {
  it('combines option requests and B2B conversations', () => {
    const requests = [
      makeRequest({ clientOrganizationId: 'org-c1', clientOrganizationName: 'Client 1' }),
    ];
    const convs = [
      makeConversation({ id: 'c1', client_organization_id: 'org-c2', title: 'Client 2' }),
    ];
    const result = extractUnifiedClientOrgs(requests, convs, {});
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.id)).toEqual(expect.arrayContaining(['org-c1', 'org-c2']));
  });

  it('deduplicates by org id and sums thread counts', () => {
    const requests = [
      makeRequest({ clientOrganizationId: 'org-c1', clientOrganizationName: 'C1' }),
      makeRequest({
        id: 'r2',
        clientOrganizationId: 'org-c1',
        clientOrganizationName: 'C1',
        threadId: 't2',
      }),
    ];
    const convs = [makeConversation({ id: 'c1', client_organization_id: 'org-c1', title: 'C1' })];
    const result = extractUnifiedClientOrgs(requests, convs, {});
    expect(result).toHaveLength(1);
    expect(result[0].threadCount).toBe(3);
  });

  it('skips agency-only requests', () => {
    const requests = [
      makeRequest({
        clientOrganizationId: 'org-c1',
        clientOrganizationName: 'C1',
        isAgencyOnly: true,
      }),
    ];
    const result = extractUnifiedClientOrgs(requests, [], {});
    expect(result).toHaveLength(0);
  });

  it('attaches assignment info', () => {
    const requests = [
      makeRequest({ clientOrganizationId: 'org-c1', clientOrganizationName: 'C1' }),
    ];
    const assignments: Record<string, ClientAssignmentFlag> = {
      'org-c1': {
        id: 'flag-1',
        agencyOrganizationId: 'org-a1',
        clientOrganizationId: 'org-c1',
        label: 'C1',
        assignedMemberUserId: 'user-42',
        assignedMemberName: 'Alice',
        color: 'green',
        isArchived: false,
        createdBy: 'user-0',
        createdAt: '',
        updatedAt: '',
      },
    };
    const result = extractUnifiedClientOrgs(requests, [], assignments);
    expect(result[0].assignment?.assignedMemberName).toBe('Alice');
  });
});

describe('applyUnifiedOrgFilter', () => {
  const assignments: Record<string, ClientAssignmentFlag> = {
    'org-c1': {
      id: 'f1',
      agencyOrganizationId: 'a1',
      clientOrganizationId: 'org-c1',
      label: 'C1',
      assignedMemberUserId: 'user-1',
      assignedMemberName: 'Bob',
      color: 'blue',
      isArchived: false,
      createdBy: 'u0',
      createdAt: '',
      updatedAt: '',
    },
  };
  const requests = [
    makeRequest({ clientOrganizationId: 'org-c1', clientName: 'C1' }),
    makeRequest({ id: 'r2', clientOrganizationId: 'org-c2', clientName: 'C2', threadId: 't2' }),
    makeRequest({
      id: 'r3',
      clientOrganizationId: 'org-c1',
      clientName: 'C1',
      threadId: 't3',
      isAgencyOnly: true,
    }),
  ];

  it('returns all when filterId is null', () => {
    expect(applyUnifiedOrgFilter(requests, null, {}, null)).toHaveLength(3);
  });

  it('filters __mine__ by assigned user', () => {
    const result = applyUnifiedOrgFilter(requests, '__mine__', assignments, 'user-1');
    expect(result).toHaveLength(2);
    expect(result.every((r) => r.clientOrganizationId === 'org-c1')).toBe(true);
  });

  it('filters __unassigned__', () => {
    const result = applyUnifiedOrgFilter(requests, '__unassigned__', assignments, 'user-1');
    expect(result).toHaveLength(1);
    expect(result[0].clientOrganizationId).toBe('org-c2');
  });

  it('filters __agency_internal__ for agency-only', () => {
    const result = applyUnifiedOrgFilter(requests, '__agency_internal__', {}, null);
    expect(result).toHaveLength(1);
    expect(result[0].isAgencyOnly).toBe(true);
  });

  it('filters by specific org id', () => {
    const result = applyUnifiedOrgFilter(requests, 'org-c2', {}, null);
    expect(result).toHaveLength(1);
    expect(result[0].clientOrganizationId).toBe('org-c2');
  });
});

describe('applyUnifiedOrgFilterToB2B', () => {
  const convs = [
    makeConversation({ id: 'c1', client_organization_id: 'org-c1' }),
    makeConversation({ id: 'c2', client_organization_id: 'org-c2' }),
  ];

  it('returns all when filterId is null', () => {
    expect(applyUnifiedOrgFilterToB2B(convs, null, {}, null)).toHaveLength(2);
  });

  it('returns empty for __agency_internal__', () => {
    expect(applyUnifiedOrgFilterToB2B(convs, '__agency_internal__', {}, null)).toHaveLength(0);
  });

  it('filters by specific org id', () => {
    const result = applyUnifiedOrgFilterToB2B(convs, 'org-c1', {}, null);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('c1');
  });
});
