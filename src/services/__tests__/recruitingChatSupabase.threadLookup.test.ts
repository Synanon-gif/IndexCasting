jest.mock('../../../lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
  },
}));

import { supabase } from '../../../lib/supabase';
import { findLatestThreadIdForApplication } from '../recruitingChatSupabase';

const from = supabase.from as jest.Mock;

describe('recruitingChatSupabase findLatestThreadIdForApplication', () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('returns thread id when a row exists', async () => {
    const maybeSingle = jest.fn().mockResolvedValue({ data: { id: 'thr-1' }, error: null });
    from.mockReturnValue({
      select: () => ({
        eq: () => ({
          order: () => ({
            limit: () => ({ maybeSingle }),
          }),
        }),
      }),
    });
    await expect(findLatestThreadIdForApplication('app-1')).resolves.toBe('thr-1');
  });

  it('returns null when none', async () => {
    const maybeSingle = jest.fn().mockResolvedValue({ data: null, error: null });
    from.mockReturnValue({
      select: () => ({
        eq: () => ({
          order: () => ({
            limit: () => ({ maybeSingle }),
          }),
        }),
      }),
    });
    await expect(findLatestThreadIdForApplication('app-1')).resolves.toBeNull();
  });
});
