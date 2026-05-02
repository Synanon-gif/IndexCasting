/**
 * getPhotosForModel — query shape used by Model Settings / linked models.
 * RLS decides row visibility server-side; the client must scope by model_id only.
 */

import {
  getPhotosForModel,
  getPhotosForModelResult,
  MAX_MODEL_PHOTOS_PER_QUERY,
} from '../modelPhotosSupabase';

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
    chain.order = jest.fn().mockReturnValue(chain);
    chain.limit = jest.fn().mockResolvedValue(resolved);
    mockFrom.mockReturnValue(chain);

    await getPhotosForModel('model-uuid-abc');

    expect(mockFrom).toHaveBeenCalledWith('model_photos');
    expect(chain.select).toHaveBeenCalledWith('*');
    expect(calls.find((c) => c.col === 'model_id')?.val).toBe('model-uuid-abc');
    expect(chain.order).toHaveBeenCalledWith('sort_order', { ascending: true });
    expect(chain.limit).toHaveBeenCalledWith(MAX_MODEL_PHOTOS_PER_QUERY);
  });

  it('getPhotosForModelResult surfaces timeout error without throwing', async () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const chain: Record<string, unknown> = {};
    chain.select = jest.fn().mockReturnValue(chain);
    chain.eq = jest.fn().mockReturnValue(chain);
    chain.order = jest.fn().mockReturnValue(chain);
    chain.limit = jest.fn().mockResolvedValue({
      data: null,
      error: { code: '57014', message: 'canceling statement due to statement timeout' },
    });
    mockFrom.mockReturnValue(chain);

    const r = await getPhotosForModelResult('m-timeout');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errorCode).toBe('57014');
      expect(r.photos).toEqual([]);
    }
    const empty = await getPhotosForModel('m-timeout');
    expect(empty).toEqual([]);
    errSpy.mockRestore();
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
    chain.order = jest.fn().mockReturnValue(chain);
    chain.limit = jest.fn().mockResolvedValue(resolved);
    mockFrom.mockReturnValue(chain);

    await getPhotosForModel('m1', 'portfolio');

    expect(calls).toEqual(
      expect.arrayContaining([
        { col: 'model_id', val: 'm1' },
        { col: 'photo_type', val: 'portfolio' },
      ]),
    );
  });

  it('coalesces concurrent getPhotosForModelResult for same model (single query chain)', async () => {
    const resolved = { data: [], error: null };
    const chain: Record<string, unknown> = {};
    let limitHits = 0;
    chain.select = jest.fn().mockReturnValue(chain);
    chain.eq = jest.fn().mockReturnValue(chain);
    chain.order = jest.fn().mockReturnValue(chain);
    chain.limit = jest.fn().mockImplementation(() => {
      limitHits += 1;
      return Promise.resolve(resolved);
    });
    mockFrom.mockReturnValue(chain);

    const [a, b] = await Promise.all([
      getPhotosForModelResult('same-id'),
      getPhotosForModelResult('same-id'),
    ]);
    expect(a.ok && b.ok).toBe(true);
    expect(limitHits).toBe(1);
  });
});
