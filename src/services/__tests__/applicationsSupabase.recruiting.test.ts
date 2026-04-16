jest.mock('../../../lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
    rpc: jest.fn(),
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
const rpc = supabase.rpc as jest.Mock;

describe('applicationsSupabase (recruiting helpers)', () => {
  let consoleErrorSpy: jest.SpyInstance;
  let consoleWarnSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    rpc.mockReset();
    rpc.mockResolvedValue({ data: null, error: null });
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
    // Now chains: .update().eq(id).eq(priorStatus).select().maybeSingle()
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
    await expect(
      updateApplicationStatus('app-1', 'pending_model_confirmation', {
        accepted_by_agency_id: 'ag-1',
      }),
    ).resolves.toBe(true);
  });

  it('updateApplicationStatus returns false when prior-status guard matches zero rows', async () => {
    // Guard fires: the prior status doesn't match → 0 rows updated → false
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
    await expect(updateApplicationStatus('missing-id', 'rejected')).resolves.toBe(false);
  });

  it('updateApplicationStatus returns true when a row is updated', async () => {
    // accepted ← requires prior status = 'pending_model_confirmation'
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
    await expect(
      updateApplicationStatus('app-1', 'accepted', { accepted_by_agency_id: 'ag-1' }),
    ).resolves.toBe(true);
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

    it('calls conversion RPC, verifies MAT when pending territories, and ensures direct conversation', async () => {
      const maybeSingle = jest.fn().mockResolvedValue({
        data: {
          id: 'app-1',
          accepted_by_agency_id: 'ag-1',
          pending_territories: ['de', 'FR'],
        },
        error: null,
      });
      const matMaybeSingle = jest.fn().mockResolvedValue({
        data: { id: 'mat-1' },
        error: null,
      });
      from.mockImplementation((table: string) => {
        if (table === 'model_applications') {
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
        if (table === 'model_agency_territories') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  limit: () => ({ maybeSingle: matMaybeSingle }),
                }),
              }),
            }),
          };
        }
        return {};
      });
      rpc.mockImplementation((fn: string) => {
        if (fn === 'create_model_from_accepted_application') {
          return Promise.resolve({ data: 'merged-model-id', error: null });
        }
        if (fn === 'ensure_agency_model_direct_conversation') {
          return Promise.resolve({ data: 'conv-1', error: null });
        }
        return Promise.resolve({ data: null, error: null });
      });

      const result = await confirmApplicationByModel('app-1', 'user-1');
      expect(result).toEqual({ modelId: 'merged-model-id' });
      expect(from).toHaveBeenCalledWith('model_agency_territories');
      expect(rpc).toHaveBeenCalledWith('create_model_from_accepted_application', {
        p_application_id: 'app-1',
      });
      expect(rpc).toHaveBeenCalledWith('ensure_agency_model_direct_conversation', {
        p_agency_id: 'ag-1',
        p_model_id: 'merged-model-id',
      });
    });

    it('logs when MAT is missing despite pending territories', async () => {
      const maybeSingle = jest.fn().mockResolvedValue({
        data: {
          id: 'app-1',
          accepted_by_agency_id: 'ag-1',
          pending_territories: ['DE'],
        },
        error: null,
      });
      const matMaybeSingle = jest.fn().mockResolvedValue({ data: null, error: null });
      from.mockImplementation((table: string) => {
        if (table === 'model_applications') {
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
        if (table === 'model_agency_territories') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  limit: () => ({ maybeSingle: matMaybeSingle }),
                }),
              }),
            }),
          };
        }
        return {};
      });
      rpc.mockImplementation((fn: string) => {
        if (fn === 'create_model_from_accepted_application') {
          return Promise.resolve({ data: 'merged-model-id', error: null });
        }
        if (fn === 'ensure_agency_model_direct_conversation') {
          return Promise.resolve({ data: 'conv-1', error: null });
        }
        return Promise.resolve({ data: null, error: null });
      });

      const result = await confirmApplicationByModel('app-1', 'user-1');
      expect(result).toEqual({ modelId: 'merged-model-id' });
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[recruiting] MAT missing'),
        expect.objectContaining({
          applicationId: 'app-1',
          modelId: 'merged-model-id',
          agencyId: 'ag-1',
        }),
      );
    });

    it('does not call ensure direct conversation when accepted_by_agency_id is missing', async () => {
      const maybeSingle = jest.fn().mockResolvedValue({
        data: { id: 'app-1', accepted_by_agency_id: null },
        error: null,
      });
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
      rpc.mockImplementation((fn: string) => {
        if (fn === 'create_model_from_accepted_application') {
          return Promise.resolve({ data: 'model-x', error: null });
        }
        return Promise.resolve({ data: null, error: null });
      });
      const result = await confirmApplicationByModel('app-1', 'user-1');
      expect(result).toEqual({ modelId: 'model-x' });
      expect(rpc).toHaveBeenCalledWith('create_model_from_accepted_application', {
        p_application_id: 'app-1',
      });
      expect(rpc).not.toHaveBeenCalledWith(
        'ensure_agency_model_direct_conversation',
        expect.any(Object),
      );
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
