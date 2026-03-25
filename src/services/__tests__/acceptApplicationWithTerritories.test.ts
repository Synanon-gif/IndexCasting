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
  beforeEach(() => jest.clearAllMocks());

  it('handles empty model ids list gracefully', async () => {
    const { succeededIds, failedIds } = await bulkUpsertTerritoriesForModels([], 'a1', ['DE']);
    expect((supabase.rpc as jest.Mock)).not.toHaveBeenCalled();
    expect(succeededIds).toEqual([]);
    expect(failedIds).toEqual([]);
  });

  it('records succeededIds when save succeeds', async () => {
    (supabase.rpc as jest.Mock)
      .mockResolvedValueOnce({ data: true, error: null })   // save_model_territories
      .mockResolvedValueOnce({ data: [], error: null });     // get_territories_for_model

    const { succeededIds, failedIds } = await bulkUpsertTerritoriesForModels(
      ['model-1'], 'a1', ['DE'],
    );
    expect(succeededIds).toContain('model-1');
    expect(failedIds).toEqual([]);
  });

  it('records failedIds when save RPC returns error', async () => {
    (supabase.rpc as jest.Mock).mockResolvedValue({
      data: null, error: { message: 'Not authorized' },
    });
    const { succeededIds, failedIds } = await bulkUpsertTerritoriesForModels(
      ['model-err'], 'a1', ['DE'],
    );
    expect(failedIds).toContain('model-err');
    expect(succeededIds).toEqual([]);
  });

  it('records failedIds when RPC throws', async () => {
    (supabase.rpc as jest.Mock).mockRejectedValue(new Error('network timeout'));
    const { succeededIds, failedIds } = await bulkUpsertTerritoriesForModels(
      ['model-err'], 'a1', ['DE'],
    );
    expect(failedIds).toContain('model-err');
    expect(succeededIds).toEqual([]);
  });

  it('processes each model independently (partial failure)', async () => {
    (supabase.rpc as jest.Mock)
      .mockResolvedValueOnce({ data: true, error: null })             // model-ok: save
      .mockResolvedValueOnce({ data: [], error: null })               // model-ok: refetch
      .mockResolvedValueOnce({ data: null, error: { message: 'auth failed' } }); // model-err: save fails

    const { succeededIds, failedIds } = await bulkUpsertTerritoriesForModels(
      ['model-ok', 'model-err'], 'a1', ['DE'],
    );
    expect(succeededIds).toContain('model-ok');
    expect(failedIds).toContain('model-err');
  });
});
