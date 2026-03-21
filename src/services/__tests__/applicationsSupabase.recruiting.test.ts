jest.mock('../../../lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
  },
}));

import { supabase } from '../../../lib/supabase';
import { fetchApplicationById, updateApplicationRecruitingThread } from '../applicationsSupabase';

const from = supabase.from as jest.Mock;

describe('applicationsSupabase (recruiting helpers)', () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('fetchApplicationById returns row when found', async () => {
    const maybeSingle = jest.fn().mockResolvedValue({
      data: { id: 'app-1', status: 'pending', first_name: 'A' },
      error: null,
    });
    from.mockReturnValue({
      select: () => ({
        eq: () => ({ maybeSingle }),
      }),
    });
    const row = await fetchApplicationById('app-1');
    expect(row?.id).toBe('app-1');
    expect(from).toHaveBeenCalledWith('model_applications');
  });

  it('fetchApplicationById returns null on error', async () => {
    const maybeSingle = jest.fn().mockResolvedValue({ data: null, error: { message: 'rls' } });
    from.mockReturnValue({
      select: () => ({
        eq: () => ({ maybeSingle }),
      }),
    });
    await expect(fetchApplicationById('bad')).resolves.toBeNull();
  });

  it('updateApplicationRecruitingThread returns true when a pending row is updated', async () => {
    const maybeSingle = jest.fn().mockResolvedValue({ data: { id: 'app-1' }, error: null });
    from.mockReturnValue({
      update: () => ({
        eq: () => ({
          eq: () => ({
            select: () => ({ maybeSingle }),
          }),
        }),
      }),
    });
    await expect(updateApplicationRecruitingThread('app-1', 'thread-1')).resolves.toBe(true);
  });

  it('updateApplicationRecruitingThread returns false when no row matched', async () => {
    const maybeSingle = jest.fn().mockResolvedValue({ data: null, error: null });
    from.mockReturnValue({
      update: () => ({
        eq: () => ({
          eq: () => ({
            select: () => ({ maybeSingle }),
          }),
        }),
      }),
    });
    await expect(updateApplicationRecruitingThread('app-1', 'thread-1')).resolves.toBe(false);
  });
});
