jest.mock('../../../lib/supabase', () => ({
  supabase: {
    rpc: jest.fn(),
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

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns false when rpc error', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'rpc failed' } });
    await expect(removeModelFromAgency('model-1', 'agency-1')).resolves.toBe(false);
  });

  it('returns false when data is false and error is null (no silent success)', async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    await expect(removeModelFromAgency('model-1', 'agency-1')).resolves.toBe(false);
  });

  it('returns true when data is true', async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    await expect(removeModelFromAgency('model-1', 'agency-1')).resolves.toBe(true);
  });

  it('invokes logAction when organizationId is provided and RPC succeeds', async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    await removeModelFromAgency('model-1', 'agency-1', { organizationId: 'org-1' });
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

  it('does not invoke logAction when organizationId is omitted', async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    await removeModelFromAgency('model-1', 'agency-1');
    expect(logAction).not.toHaveBeenCalled();
  });
});
