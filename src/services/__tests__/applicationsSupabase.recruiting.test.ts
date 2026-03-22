jest.mock('../../../lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
  },
}));

import { supabase } from '../../../lib/supabase';
import { fetchApplicationById, updateApplicationRecruitingThread, updateApplicationStatus } from '../applicationsSupabase';

const from = supabase.from as jest.Mock;

describe('applicationsSupabase (recruiting helpers)', () => {
  let consoleErrorSpy: jest.SpyInstance;
  let consoleWarnSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
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

  it('updateApplicationStatus returns false when RLS updates zero rows', async () => {
    const maybeSingle = jest.fn().mockResolvedValue({ data: null, error: null });
    from.mockReturnValue({
      update: () => ({
        eq: () => ({
          select: () => ({ maybeSingle }),
        }),
      }),
    });
    await expect(updateApplicationStatus('missing-id', 'rejected')).resolves.toBe(false);
  });

  it('updateApplicationStatus returns true when a row is updated', async () => {
    const maybeSingle = jest.fn().mockResolvedValue({ data: { id: 'app-1' }, error: null });
    from.mockReturnValue({
      update: () => ({
        eq: () => ({
          select: () => ({ maybeSingle }),
        }),
      }),
    });
    await expect(updateApplicationStatus('app-1', 'accepted', { accepted_by_agency_id: 'ag-1' })).resolves.toBe(true);
  });
});
