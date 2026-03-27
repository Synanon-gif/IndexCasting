jest.mock('../../../lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }) },
  },
}));

import { supabase } from '../../../lib/supabase';
import {
  fetchApplicationById,
  updateApplicationRecruitingThread,
  updateApplicationStatus,
  confirmApplicationByModel,
  rejectApplicationByModel,
} from '../applicationsSupabase';

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

  it('updateApplicationStatus accepts pending_model_confirmation as valid status', async () => {
    const maybeSingle = jest.fn().mockResolvedValue({ data: { id: 'app-1' }, error: null });
    from.mockReturnValue({
      update: () => ({
        eq: () => ({
          select: () => ({ maybeSingle }),
        }),
      }),
    });
    await expect(
      updateApplicationStatus('app-1', 'pending_model_confirmation', { accepted_by_agency_id: 'ag-1' }),
    ).resolves.toBe(true);
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

  // ─── confirmApplicationByModel ──────────────────────────────────────────────

  describe('confirmApplicationByModel', () => {
    it('returns null when the status update finds no matching row', async () => {
      const maybeSingle = jest.fn().mockResolvedValue({ data: null, error: null });
      from.mockReturnValue({
        update: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                select: () => ({ maybeSingle }),
              }),
            }),
          }),
        }),
      });
      const result = await confirmApplicationByModel('app-1', 'user-1');
      expect(result).toBeNull();
    });

    it('returns null on DB error during status update', async () => {
      const maybeSingle = jest.fn().mockResolvedValue({ data: null, error: { message: 'rls' } });
      from.mockReturnValue({
        update: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                select: () => ({ maybeSingle }),
              }),
            }),
          }),
        }),
      });
      const result = await confirmApplicationByModel('app-1', 'user-1');
      expect(result).toBeNull();
    });

    it('calls createModelFromApplication after successful status update', async () => {
      let callCount = 0;
      from.mockImplementation((table: string) => {
        if (table === 'model_applications') {
          callCount++;
          if (callCount === 1) {
            // First call: status update
            const maybeSingle = jest.fn().mockResolvedValue({ data: { id: 'app-1' }, error: null });
            return {
              update: () => ({
                eq: () => ({
                  eq: () => ({
                    eq: () => ({
                      select: () => ({ maybeSingle }),
                    }),
                  }),
                }),
              }),
            };
          }
          // Second call: createModelFromApplication fetch
          const single = jest.fn().mockResolvedValue({
            data: { id: 'app-1', status: 'accepted', accepted_by_agency_id: 'ag-1', first_name: 'A', last_name: 'B', height: 175, applicant_user_id: 'user-1', images: {}, gender: null, city: null, hair_color: null, country_code: null, ethnicity: null },
            error: null,
          });
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({ single }),
                single,
              }),
              single,
            }),
          };
        }
        if (table === 'models') {
          // Guard check: user already has model
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
              }),
            }),
            insert: () => ({
              select: () => ({
                single: jest.fn().mockResolvedValue({ data: { id: 'model-new' }, error: null }),
              }),
            }),
          };
        }
        if (table === 'model_photos') {
          return { insert: jest.fn().mockResolvedValue({ error: null }) };
        }
        return {};
      });

      const result = await confirmApplicationByModel('app-1', 'user-1');
      // Result should not be null (status update succeeded)
      expect(result).not.toBeNull();
    });
  });

  // ─── rejectApplicationByModel ────────────────────────────────────────────────

  describe('rejectApplicationByModel', () => {
    it('returns true when pending_model_confirmation row is rejected', async () => {
      const maybeSingle = jest.fn().mockResolvedValue({ data: { id: 'app-1' }, error: null });
      from.mockReturnValue({
        update: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                select: () => ({ maybeSingle }),
              }),
            }),
          }),
        }),
      });
      await expect(rejectApplicationByModel('app-1', 'user-1')).resolves.toBe(true);
    });

    it('returns false when no row matched (wrong status or RLS)', async () => {
      const maybeSingle = jest.fn().mockResolvedValue({ data: null, error: null });
      from.mockReturnValue({
        update: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                select: () => ({ maybeSingle }),
              }),
            }),
          }),
        }),
      });
      await expect(rejectApplicationByModel('app-1', 'user-1')).resolves.toBe(false);
    });

    it('returns false on DB error', async () => {
      const maybeSingle = jest.fn().mockResolvedValue({ data: null, error: { message: 'error' } });
      from.mockReturnValue({
        update: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                select: () => ({ maybeSingle }),
              }),
            }),
          }),
        }),
      });
      await expect(rejectApplicationByModel('app-1', 'user-1')).resolves.toBe(false);
    });
  });
});
