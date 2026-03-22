import { SUPABASE_PAGE_SIZE, fetchAllSupabasePages } from '../supabaseFetchAll';

describe('fetchAllSupabasePages', () => {
  it('concatenates pages until a short page', async () => {
    const rows = Array.from({ length: SUPABASE_PAGE_SIZE + 50 }, (_, i) => ({ id: i }));
    let calls = 0;
    const result = await fetchAllSupabasePages<{ id: number }>(async (from, to) => {
      calls += 1;
      const slice = rows.slice(from, to + 1);
      return { data: slice, error: null };
    });
    expect(result.length).toBe(rows.length);
    expect(calls).toBe(2);
  });

  it('stops on error and returns partial data', async () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const result = await fetchAllSupabasePages<{ id: number }>(async () => ({
      data: null,
      error: { message: 'fail', code: 'x', details: '', hint: '' } as any,
    }));
    errSpy.mockRestore();
    expect(result).toEqual([]);
  });
});
