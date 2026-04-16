jest.mock('../../../lib/supabase', () => ({
  supabase: {
    rpc: jest.fn(),
    from: jest.fn(),
  },
}));

jest.mock('../../utils/logAction', () => ({
  logAction: jest.fn(() => true),
}));

import { supabase } from '../../../lib/supabase';
import { removeModelFromAgency } from '../modelsSupabase';
import { logAction } from '../../utils/logAction';

describe('removeModelFromAgency', () => {
  const rpc = supabase.rpc as jest.Mock;
  const from = supabase.from as jest.Mock;
  const mockMaybeSingle = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    from.mockReturnValue({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          maybeSingle: mockMaybeSingle,
        }),
      }),
    });
    mockMaybeSingle.mockResolvedValue({
      data: { agency_id: 'agency-1', type: 'agency' },
      error: null,
    });
  });

  it('returns false when organization lookup errors', async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: { message: 'rls' } });
    await expect(
      removeModelFromAgency({ modelId: 'model-1', organizationId: 'org-1' }),
    ).resolves.toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('returns false when org is not agency', async () => {
    mockMaybeSingle.mockResolvedValueOnce({
      data: { agency_id: 'agency-1', type: 'client' },
      error: null,
    });
    await expect(
      removeModelFromAgency({ modelId: 'model-1', organizationId: 'org-1' }),
    ).resolves.toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('returns false when rpc error', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'rpc failed' } });
    await expect(
      removeModelFromAgency({ modelId: 'model-1', organizationId: 'org-1' }),
    ).resolves.toBe(false);
    expect(rpc).toHaveBeenCalledWith('agency_remove_model', {
      p_model_id: 'model-1',
      p_agency_id: 'agency-1',
    });
  });

  it('returns false when data is false and error is null (no silent success)', async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    await expect(
      removeModelFromAgency({ modelId: 'model-1', organizationId: 'org-1' }),
    ).resolves.toBe(false);
  });

  it('returns true when data is true', async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    await expect(
      removeModelFromAgency({ modelId: 'model-1', organizationId: 'org-1' }),
    ).resolves.toBe(true);
  });

  it('invokes logAction when RPC succeeds', async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    await removeModelFromAgency({ modelId: 'model-1', organizationId: 'org-1' });
    expect(logAction).toHaveBeenCalledWith(
      'org-1',
      'removeModelFromAgency',
      expect.objectContaining({
        type: 'audit',
        action: 'model_removed',
        entityId: 'model-1',
        newData: { agencyId: 'agency-1', endRepresentation: true },
      }),
    );
  });

  it('returns false when modelId or organizationId missing', async () => {
    await expect(removeModelFromAgency({ modelId: '', organizationId: 'org-1' })).resolves.toBe(
      false,
    );
    await expect(removeModelFromAgency({ modelId: 'm1', organizationId: '  ' })).resolves.toBe(
      false,
    );
    expect(rpc).not.toHaveBeenCalled();
  });
});
