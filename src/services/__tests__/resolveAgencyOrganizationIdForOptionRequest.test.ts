/**
 * resolveAgencyOrganizationIdForOptionRequest — RPC wrapper for agency org UUID.
 */

jest.mock('../../../lib/supabase', () => ({
  supabase: {
    rpc: jest.fn(),
  },
}));

import { supabase } from '../../../lib/supabase';
import { resolveAgencyOrganizationIdForOptionRequest } from '../optionRequestsSupabase';

const rpc = supabase.rpc as jest.Mock;

describe('resolveAgencyOrganizationIdForOptionRequest', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns null when modelId or agencyId is blank', async () => {
    await expect(resolveAgencyOrganizationIdForOptionRequest('', 'a1', 'DE')).resolves.toBeNull();
    await expect(resolveAgencyOrganizationIdForOptionRequest('m1', '  ', 'DE')).resolves.toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('calls RPC with trimmed ids and null country when empty', async () => {
    rpc.mockResolvedValue({ data: 'org-agency-uuid', error: null });
    const out = await resolveAgencyOrganizationIdForOptionRequest('  mid  ', ' aid ', '   ');
    expect(out).toBe('org-agency-uuid');
    expect(rpc).toHaveBeenCalledWith('resolve_agency_organization_id_for_option_request', {
      p_model_id: 'mid',
      p_agency_id: 'aid',
      p_country_code: null,
    });
  });

  it('returns null on RPC error', async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: 'P0001', message: 'access_denied', details: null, hint: null },
    });
    await expect(
      resolveAgencyOrganizationIdForOptionRequest('m1', 'a1', 'DE'),
    ).resolves.toBeNull();
  });
});
