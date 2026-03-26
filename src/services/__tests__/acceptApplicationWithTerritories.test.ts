/**
 * Tests for bulkUpsertTerritoriesForModels.
 * save_model_territories RPC now RETURNS BOOLEAN.
 * After save succeeds, upsertTerritoriesForModel re-fetches via get_territories_for_model.
 */

jest.mock('../../../lib/supabase', () => ({
  supabase: {
    rpc: jest.fn(),
    from: jest.fn(),
  },
}));
jest.mock('../../config/env', () => ({
  supabaseUrl: 'http://localhost',
  supabaseAnonKey: 'test-key',
}));

import { supabase } from '../../../lib/supabase';
import { bulkUpsertTerritoriesForModels } from '../territoriesSupabase';

describe('bulkUpsertTerritoriesForModels', () => {
  // resetAllMocks clears queued mockResolvedValueOnce values between tests.
  // clearAllMocks only resets call history, not the implementation queue.
  beforeEach(() => jest.resetAllMocks());

  it('handles empty model ids list gracefully', async () => {
    const { succeededIds, failedIds } = await bulkUpsertTerritoriesForModels([], 'a1', ['DE']);
    expect((supabase.rpc as jest.Mock)).not.toHaveBeenCalled();
    expect(succeededIds).toEqual([]);
    expect(failedIds).toEqual([]);
  });

  it('records succeededIds when bulk RPC succeeds', async () => {
    // New behavior: bulk_save_model_territories succeeds → all models returned as succeeded.
    // Only 1 RPC call is made (no per-model serial calls).
    (supabase.rpc as jest.Mock)
      .mockResolvedValueOnce({ data: true, error: null }); // bulk_save_model_territories

    const { succeededIds, failedIds } = await bulkUpsertTerritoriesForModels(
      ['model-1'], 'a1', ['DE'],
    );
    expect(succeededIds).toContain('model-1');
    expect(failedIds).toEqual([]);
    expect((supabase.rpc as jest.Mock).mock.calls).toHaveLength(1);
  });

  it('falls back to serial and records failedIds when all RPCs throw', async () => {
    // All rpc calls throw → bulk throws → serial fallback → serial save also throws → failedIds
    (supabase.rpc as jest.Mock).mockRejectedValue(new Error('network timeout'));
    const { succeededIds, failedIds } = await bulkUpsertTerritoriesForModels(
      ['model-err'], 'a1', ['DE'],
    );
    expect(failedIds).toContain('model-err');
    expect(succeededIds).toEqual([]);
  });

  it('processes each model independently in serial fallback (partial failure)', async () => {
    // bulk throws → serial fallback
    // model-ok: serial save succeeds, refetch succeeds → succeededIds
    // model-err: serial save throws → failedIds
    (supabase.rpc as jest.Mock)
      .mockRejectedValueOnce(new Error('bulk unavailable'))  // bulk throws → serial fallback
      .mockResolvedValueOnce({ data: true, error: null })    // model-ok: save succeeds
      .mockResolvedValueOnce({ data: [], error: null })      // model-ok: get_territories refetch
      .mockRejectedValueOnce(new Error('auth failed'));      // model-err: save throws

    const { succeededIds, failedIds } = await bulkUpsertTerritoriesForModels(
      ['model-ok', 'model-err'], 'a1', ['DE'],
    );
    expect(succeededIds).toContain('model-ok');
    expect(failedIds).toContain('model-err');
  });
});
