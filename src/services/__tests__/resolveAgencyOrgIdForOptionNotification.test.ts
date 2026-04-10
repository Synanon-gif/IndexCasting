/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Agency org for notifications: prefer option_requests.agency_organization_id (RLS-safe for clients).
 */

jest.mock('../../../lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
  },
}));

import { supabase } from '../../../lib/supabase';
import { resolveAgencyOrgIdForOptionNotification } from '../optionRequestsSupabase';

const from = supabase.from as jest.Mock;

describe('resolveAgencyOrgIdForOptionNotification', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns trimmed agency_organization_id without querying organizations', async () => {
    const r = await resolveAgencyOrgIdForOptionNotification('ag-1', '  org-pinned-1  ');
    expect(r).toBe('org-pinned-1');
    expect(from).not.toHaveBeenCalled();
  });

  it('falls back to organizations lookup when agency_organization_id is empty', async () => {
    from.mockImplementation((table: string) => {
      if (table === 'organizations') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { id: 'org-from-table' } }),
            }),
          }),
        };
      }
      return {};
    });

    const r = await resolveAgencyOrgIdForOptionNotification('ag-2', null);
    expect(r).toBe('org-from-table');
    expect(from).toHaveBeenCalledWith('organizations');
  });
});
