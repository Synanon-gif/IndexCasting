jest.mock('../../../lib/supabase', () => ({
  supabase: { from: jest.fn() },
}));

import { supabase } from '../../../lib/supabase';
import { getModelsForAgencyFromSupabase } from '../modelsSupabase';

describe('getModelsForAgencyFromSupabase (MAT-canonical roster)', () => {
  const from = supabase.from as jest.Mock;

  function chainMatRows(rows: { model_id: string }[]) {
    return {
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          order: jest.fn().mockReturnValue({
            range: jest.fn().mockResolvedValue({ data: rows, error: null }),
          }),
        }),
      }),
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns [] for empty agency id', async () => {
    await expect(getModelsForAgencyFromSupabase('  ')).resolves.toEqual([]);
    expect(from).not.toHaveBeenCalled();
  });

  it('returns [] when MAT has no rows (removed model / empty roster)', async () => {
    from.mockImplementation((table: string) => {
      if (table === 'model_agency_territories') return chainMatRows([]);
      throw new Error(`unexpected table ${table}`);
    });
    await expect(getModelsForAgencyFromSupabase('agency-1')).resolves.toEqual([]);
    expect(from).toHaveBeenCalledTimes(1);
  });

  it('loads models only by MAT ids (chunked .in), not models.agency_id', async () => {
    const matRows = [{ model_id: 'm-linked' }];
    const modelRow = {
      id: 'm-linked',
      name: 'Alex',
      user_id: 'user-1',
      agency_relationship_status: 'active',
    };

    const inSpy = jest.fn().mockReturnValue({
      or: jest.fn().mockReturnValue({
        order: jest.fn().mockReturnValue({
          range: jest.fn().mockResolvedValue({ data: [modelRow], error: null }),
        }),
      }),
    });

    from.mockImplementation((table: string) => {
      if (table === 'model_agency_territories') return chainMatRows(matRows);
      if (table === 'models') {
        return {
          select: jest.fn().mockReturnValue({
            in: inSpy,
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    });

    const out = await getModelsForAgencyFromSupabase('agency-1');
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('m-linked');
    expect(inSpy).toHaveBeenCalledWith('id', ['m-linked']);
  });

  it('excludes a linked model when MAT no longer lists it (stale agency_id scenario)', async () => {
    from.mockImplementation((table: string) => {
      if (table === 'model_agency_territories') return chainMatRows([]);
      throw new Error(`unexpected table ${table}`);
    });
    await expect(getModelsForAgencyFromSupabase('agency-1')).resolves.toEqual([]);
  });
});
