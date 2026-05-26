import { orgDashboardOptionRequestFilters } from '../useOrgDashboardRealtimeBump';

describe('orgDashboardOptionRequestFilters', () => {
  it('returns both client org columns for client workspace', () => {
    expect(orgDashboardOptionRequestFilters('org-client-1')).toEqual([
      'organization_id=eq.org-client-1',
      'client_organization_id=eq.org-client-1',
    ]);
  });

  it('returns agency_id filter for agency workspace', () => {
    expect(orgDashboardOptionRequestFilters('org-agency-1', 'agency-uuid')).toEqual([
      'agency_id=eq.agency-uuid',
    ]);
  });
});
