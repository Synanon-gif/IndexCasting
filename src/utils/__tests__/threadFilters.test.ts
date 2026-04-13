import { extractCounterparties, filterByCounterparty, type ThreadCounterparty } from '../threadFilters';
import type { OptionRequest } from '../../store/optionRequests';

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
      makeRequest({ id: 'req-2', clientOrganizationId: 'org-c1', clientOrganizationName: 'Client Org 1', threadId: 'thread-2' }),
      makeRequest({ id: 'req-3', clientOrganizationId: 'org-c2', clientOrganizationName: 'Client Org 2', threadId: 'thread-3' }),
    ];
    const result = extractCounterparties(requests, 'agency');
    expect(result).toHaveLength(2);
    expect(result.map((c) => c.id)).toEqual(expect.arrayContaining(['org-c1', 'org-c2']));
  });

  it('falls back to clientName when clientOrganizationId is missing', () => {
    const requests = [
      makeRequest({ clientOrganizationId: undefined, clientOrganizationName: undefined, clientName: 'Fallback Client' }),
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
      makeRequest({ id: 'r2', clientOrganizationId: 'org-a', clientOrganizationName: 'Alpha Inc', threadId: 't2' }),
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
