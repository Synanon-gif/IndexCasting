/**
 * Tests for bulkUpsertTerritoriesForModels (Part 7).
 * Mocks Supabase at the lowest level to avoid expo-constants import chain.
 */

jest.mock('../../../lib/supabase', () => ({ supabase: { from: jest.fn() } }));
jest.mock('../../config/env', () => ({
  supabaseUrl: 'http://localhost',
  supabaseAnonKey: 'test-key',
}));

import { supabase } from '../../../lib/supabase';
import { bulkUpsertTerritoriesForModels } from '../territoriesSupabase';

function makeSuccessChain(returnData: unknown[]) {
  const upsertChain = {
    select: jest.fn(),
    order: jest.fn(),
  };
  upsertChain.select.mockReturnValue(upsertChain);
  upsertChain.order.mockResolvedValue({ data: returnData, error: null });

  const deleteChain = {
    eq: jest.fn(),
  };
  const deleteChainEq2 = { not: jest.fn() };
  const deleteChainNot = { then: undefined, error: null };
  deleteChainEq2.not.mockResolvedValue({ error: null });
  deleteChain.eq.mockReturnValueOnce(deleteChain).mockReturnValueOnce(deleteChainEq2);

  return { deleteChain, upsertChain };
}

describe('bulkUpsertTerritoriesForModels', () => {
  beforeEach(() => jest.clearAllMocks());

  it('handles empty model ids list gracefully', async () => {
    const { succeededIds, failedIds } = await bulkUpsertTerritoriesForModels(
      [],
      'agency-1',
      ['DE'],
    );

    expect((supabase.from as jest.Mock)).not.toHaveBeenCalled();
    expect(succeededIds).toEqual([]);
    expect(failedIds).toEqual([]);
  });

  it('records succeededIds when upsert returns rows', async () => {
    const territory = { id: 't1', model_id: 'model-1', agency_id: 'a1', country_code: 'DE' };

    // delete chain
    const notChain = { error: null };
    const deleteEq2 = { not: jest.fn().mockResolvedValue({ error: null }) };
    const deleteEq1 = { eq: jest.fn().mockReturnValue(deleteEq2) };
    const deleteBase = { eq: jest.fn().mockReturnValue(deleteEq1) };

    // upsert chain
    const orderChain = { error: null, data: [territory] };
    const selectChain = { order: jest.fn().mockResolvedValue(orderChain) };
    const upsertChain = { select: jest.fn().mockReturnValue(selectChain) };

    (supabase.from as jest.Mock).mockReturnValue({
      delete: jest.fn().mockReturnValue(deleteBase),
      upsert: jest.fn().mockReturnValue(upsertChain),
    });

    const { succeededIds, failedIds } = await bulkUpsertTerritoriesForModels(
      ['model-1'],
      'a1',
      ['DE'],
    );

    expect(succeededIds).toContain('model-1');
    expect(failedIds).toEqual([]);
  });

  it('records failedIds when supabase throws', async () => {
    (supabase.from as jest.Mock).mockImplementation(() => {
      throw new Error('network timeout');
    });

    const { succeededIds, failedIds } = await bulkUpsertTerritoriesForModels(
      ['model-err'],
      'agency-1',
      ['DE'],
    );

    expect(failedIds).toContain('model-err');
    expect(succeededIds).toEqual([]);
  });

  it('processes each model independently (partial failure)', async () => {
    const territory = { id: 't1', model_id: 'model-ok', agency_id: 'a1', country_code: 'DE' };

    let callCount = 0;
    (supabase.from as jest.Mock).mockImplementation(() => {
      callCount++;
      if (callCount <= 2) {
        // model-ok: first from() call = delete, second = upsert
        const notChain = { error: null };
        const deleteEq2 = { not: jest.fn().mockResolvedValue({ error: null }) };
        const deleteEq1 = { eq: jest.fn().mockReturnValue(deleteEq2) };
        const deleteBase = { eq: jest.fn().mockReturnValue(deleteEq1) };

        const orderChain = { error: null, data: [territory] };
        const selectChain = { order: jest.fn().mockResolvedValue(orderChain) };
        const upsertChain = { select: jest.fn().mockReturnValue(selectChain) };

        return {
          delete: jest.fn().mockReturnValue(deleteBase),
          upsert: jest.fn().mockReturnValue(upsertChain),
        };
      }
      // model-err: throws
      throw new Error('timeout');
    });

    const { succeededIds, failedIds } = await bulkUpsertTerritoriesForModels(
      ['model-ok', 'model-err'],
      'a1',
      ['DE'],
    );

    expect(succeededIds).toContain('model-ok');
    expect(failedIds).toContain('model-err');
  });
});
