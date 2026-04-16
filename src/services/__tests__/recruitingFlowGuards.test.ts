jest.mock('../../../lib/supabase', () => ({
  supabase: { from: jest.fn(), rpc: jest.fn() },
}));

import { normalizePendingTerritories } from '../recruitingFlowGuards';

describe('recruitingFlowGuards', () => {
  describe('normalizePendingTerritories', () => {
    it('returns empty for null/undefined/non-array', () => {
      expect(normalizePendingTerritories(null)).toEqual([]);
      expect(normalizePendingTerritories(undefined)).toEqual([]);
      expect(normalizePendingTerritories({})).toEqual([]);
    });

    it('trims and uppercases ISO strings', () => {
      expect(normalizePendingTerritories([' de ', 'FR', '', 'us'])).toEqual(['DE', 'FR', 'US']);
    });
  });
});
