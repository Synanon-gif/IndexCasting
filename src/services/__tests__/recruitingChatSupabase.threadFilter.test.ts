/**
 * Tests for getThreadsForAgency / getThreads — defense-in-depth filter that
 * hides recruiting threads whose linked `model_applications.status` is
 * `'representation_ended'` (set by `agency_remove_model`).
 *
 * Without this filter, agencies see stale recruiting chats for models whose
 * representation was already ended — confusing when the same model later
 * re-applies and a fresh thread appears alongside the old one.
 */

jest.mock('../../../lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
  },
}));

import { supabase } from '../../../lib/supabase';
import { getThreadsForAgency, getThreads } from '../recruitingChatSupabase';

const from = supabase.from as jest.Mock;

type Row = {
  id: string;
  application_id: string;
  model_name: string;
  agency_id: string;
  organization_id: string | null;
  created_by: string | null;
  created_at: string;
  chat_type?: string | null;
  model_applications?: { status: string } | { status: string }[] | null;
};

/**
 * Builds a fully chainable, thenable query mock that resolves to the given rows.
 * Every method (`select`, `eq`, `neq`, `order`, `limit`, `lt`, ...) returns the
 * same proxy so call order doesn't matter — we only care that the rows survive
 * to the final `await`.
 */
function mockChain(rows: Row[]) {
  const result = { data: rows, error: null as unknown };
  const proxy: Record<string, unknown> = {};
  const chainable = (..._args: unknown[]) => proxy;
  ['select', 'eq', 'neq', 'order', 'limit', 'lt', 'gte', 'lte', 'in'].forEach((m) => {
    proxy[m] = jest.fn(chainable);
  });
  proxy.then = (resolve: (v: typeof result) => unknown) => Promise.resolve(result).then(resolve);
  from.mockReturnValue(proxy);
  return proxy;
}

/** Same as `mockChain` but with an error response. */
function mockChainError(message: string) {
  const result = { data: null, error: { message } as unknown };
  const proxy: Record<string, unknown> = {};
  const chainable = (..._args: unknown[]) => proxy;
  ['select', 'eq', 'neq', 'order', 'limit', 'lt'].forEach((m) => {
    proxy[m] = jest.fn(chainable);
  });
  proxy.then = (resolve: (v: typeof result) => unknown) => Promise.resolve(result).then(resolve);
  from.mockReturnValue(proxy);
  return proxy;
}

describe('recruitingChatSupabase — representation_ended filter', () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  describe('getThreadsForAgency', () => {
    it('strips threads whose embedded model_applications.status is representation_ended (defense-in-depth)', async () => {
      const rows: Row[] = [
        {
          id: 'thr-active',
          application_id: 'app-active',
          model_name: 'Active Model',
          agency_id: 'agency-1',
          organization_id: 'org-1',
          created_by: 'user-1',
          created_at: '2026-04-18T10:00:00Z',
          model_applications: { status: 'accepted' },
        },
        {
          id: 'thr-ended',
          application_id: 'app-ended',
          model_name: 'Removed Model',
          agency_id: 'agency-1',
          organization_id: 'org-1',
          created_by: 'user-1',
          created_at: '2026-04-15T10:00:00Z',
          // Edge case: the embedded filter slipped through (PostgREST or
          // intermediate layer); the client-side filter must still drop it.
          model_applications: { status: 'representation_ended' },
        },
      ];
      mockChain(rows);

      const result = await getThreadsForAgency('agency-1');

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('thr-active');
      // model_applications must not leak into the returned shape.
      expect((result[0] as Record<string, unknown>).model_applications).toBeUndefined();
    });

    it('keeps threads when application status is "accepted"', async () => {
      mockChain([
        {
          id: 'thr-1',
          application_id: 'app-1',
          model_name: 'M',
          agency_id: 'agency-1',
          organization_id: null,
          created_by: null,
          created_at: '2026-04-18T10:00:00Z',
          model_applications: { status: 'accepted' },
        },
      ]);
      const result = await getThreadsForAgency('agency-1');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('thr-1');
    });

    it('handles array-shaped embed (PostgREST sometimes returns array)', async () => {
      mockChain([
        {
          id: 'thr-1',
          application_id: 'app-1',
          model_name: 'M',
          agency_id: 'agency-1',
          organization_id: null,
          created_by: null,
          created_at: '2026-04-18T10:00:00Z',
          model_applications: [{ status: 'representation_ended' }],
        },
      ]);
      const result = await getThreadsForAgency('agency-1');
      expect(result).toHaveLength(0);
    });

    it('returns [] on supabase error', async () => {
      mockChainError('boom');
      const result = await getThreadsForAgency('agency-1');
      expect(result).toEqual([]);
    });
  });

  describe('getThreads (mit agencyId)', () => {
    it('strips representation_ended threads (client-side defense)', async () => {
      mockChain([
        {
          id: 'thr-active',
          application_id: 'app-active',
          model_name: 'Active',
          agency_id: 'agency-1',
          organization_id: null,
          created_by: null,
          created_at: '2026-04-18T10:00:00Z',
          model_applications: { status: 'accepted' },
        },
        {
          id: 'thr-ended',
          application_id: 'app-ended',
          model_name: 'Ended',
          agency_id: 'agency-1',
          organization_id: null,
          created_by: null,
          created_at: '2026-04-10T10:00:00Z',
          model_applications: { status: 'representation_ended' },
        },
      ]);

      const result = await getThreads('agency-1');

      expect(result.map((r) => r.id)).toEqual(['thr-active']);
    });
  });
});
