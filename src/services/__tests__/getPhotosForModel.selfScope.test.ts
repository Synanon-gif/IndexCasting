/**
 * getPhotosForModel — query shape used by Model Settings / linked models.
 * RLS decides row visibility server-side; the client must scope by model_id only.
 */

import { getPhotosForModel } from '../modelPhotosSupabase';

const mockFrom = jest.fn();

jest.mock('../../../lib/supabase', () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
  },
}));

describe('getPhotosForModel — model_id scope', () => {
  beforeEach(() => {
    mockFrom.mockReset();
  });

  it('queries model_photos with eq(model_id, passed id)', async () => {
    const calls: Record<string, unknown>[] = [];
    const resolved = { data: [], error: null };
    const chain: Record<string, unknown> = {};
    chain.select = jest.fn().mockReturnValue(chain);
    chain.eq = jest.fn().mockImplementation((col: string, val: unknown) => {
      calls.push({ col, val });
      return chain;
    });
    chain.order = jest.fn().mockResolvedValue(resolved);
    mockFrom.mockReturnValue(chain);

    await getPhotosForModel('model-uuid-abc');

    expect(mockFrom).toHaveBeenCalledWith('model_photos');
    expect(chain.select).toHaveBeenCalledWith('*');
    expect(calls.find((c) => c.col === 'model_id')?.val).toBe('model-uuid-abc');
    expect(chain.order).toHaveBeenCalledWith('sort_order', { ascending: true });
  });

  it('adds photo_type filter when type arg is set', async () => {
    const calls: Record<string, unknown>[] = [];
    const resolved = { data: [], error: null };
    const chain: Record<string, unknown> = {};
    chain.select = jest.fn().mockReturnValue(chain);
    chain.eq = jest.fn().mockImplementation((col: string, val: unknown) => {
      calls.push({ col, val });
      return chain;
    });
    chain.order = jest.fn().mockResolvedValue(resolved);
    mockFrom.mockReturnValue(chain);

    await getPhotosForModel('m1', 'portfolio');

    expect(calls).toEqual(
      expect.arrayContaining([
        { col: 'model_id', val: 'm1' },
        { col: 'photo_type', val: 'portfolio' },
      ]),
    );
  });
});
