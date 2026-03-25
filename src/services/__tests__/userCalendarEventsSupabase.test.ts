/**
 * Tests for userCalendarEventsSupabase.ts
 * Covers: getManualEventsForOrg (org-wide shared calendar events),
 *         getManualEventsForOwner, insertManualEvent, updateManualEvent,
 *         deleteManualEvent.
 */
import {
  getManualEventsForOrg,
  getManualEventsForOwner,
  insertManualEvent,
  updateManualEvent,
  deleteManualEvent,
  type UserCalendarEvent,
} from '../userCalendarEventsSupabase';

// ---------------------------------------------------------------------------
// Supabase mock
// ---------------------------------------------------------------------------

const eqMock   = jest.fn();
const orderMock = jest.fn();
const selectMock = jest.fn();
const insertMock = jest.fn();
const updateMock = jest.fn();
const deleteMock = jest.fn();
const singleMock = jest.fn();

/** Build a chainable mock that resolves at the terminal call with `result`. */
function makeChain(result: unknown) {
  const chain: Record<string, jest.Mock> = {};
  const methods = ['select', 'insert', 'update', 'delete', 'eq', 'order', 'single', 'maybeSingle', 'upsert'];
  methods.forEach((m) => {
    chain[m] = jest.fn(() => {
      if (m === 'single' || m === 'maybeSingle') return Promise.resolve(result);
      return chain;
    });
  });
  // Terminal .order() – the last call in getManualEventsForOwner/Org chains.
  // We make the second .order() call resolve the promise.
  let orderCallCount = 0;
  chain['order'] = jest.fn(() => {
    orderCallCount += 1;
    if (orderCallCount >= 2) return Promise.resolve(result);
    return chain;
  });
  return chain;
}

jest.mock('../../../lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
    auth: { getUser: jest.fn() },
  },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { supabase } = require('../../../lib/supabase') as {
  supabase: {
    from: jest.Mock;
    auth: { getUser: jest.Mock };
  };
};

const VALID_UUID    = '00000000-0000-0000-0000-000000000001';
const VALID_ORG_ID  = '00000000-0000-0000-0000-000000000002';
const VALID_USER_ID = '00000000-0000-0000-0000-000000000003';

const SAMPLE_EVENT: UserCalendarEvent = {
  id: VALID_UUID,
  owner_id: VALID_USER_ID,
  owner_type: 'client',
  date: '2026-06-01',
  start_time: '09:00',
  end_time: '17:00',
  title: 'Team planning',
  color: '#1565C0',
  note: null,
  organization_id: VALID_ORG_ID,
  created_by: VALID_USER_ID,
  source_option_request_id: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// getManualEventsForOrg
// ---------------------------------------------------------------------------

describe('getManualEventsForOrg', () => {
  it('returns events when organisation exists and user is a member', async () => {
    const chain = makeChain({ data: [SAMPLE_EVENT], error: null });
    supabase.from.mockReturnValue(chain);

    const result = await getManualEventsForOrg(VALID_ORG_ID, 'client');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(VALID_UUID);
    expect(result[0].organization_id).toBe(VALID_ORG_ID);
  });

  it('filters by organization_id and owner_type', async () => {
    const chain = makeChain({ data: [], error: null });
    supabase.from.mockReturnValue(chain);

    await getManualEventsForOrg(VALID_ORG_ID, 'agency');

    // The chain's eq() should have been called with organization_id and agency
    const eqCalls = (chain['eq'] as jest.Mock).mock.calls;
    expect(eqCalls.some(([col]: [string]) => col === 'organization_id')).toBe(true);
    expect(eqCalls.some(([col, val]: [string, string]) => col === 'owner_type' && val === 'agency')).toBe(true);
  });

  it('returns empty array when supabase returns an error', async () => {
    const chain = makeChain({ data: null, error: { message: 'RLS denied' } });
    supabase.from.mockReturnValue(chain);

    const result = await getManualEventsForOrg(VALID_ORG_ID, 'client');
    expect(result).toEqual([]);
  });

  it('returns empty array for invalid UUID', async () => {
    const result = await getManualEventsForOrg('not-a-uuid', 'client');
    expect(result).toEqual([]);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('returns empty array on thrown exception', async () => {
    supabase.from.mockImplementation(() => { throw new Error('network'); });
    const result = await getManualEventsForOrg(VALID_ORG_ID, 'client');
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getManualEventsForOwner
// ---------------------------------------------------------------------------

describe('getManualEventsForOwner', () => {
  it('returns events for a valid owner UUID', async () => {
    const chain = makeChain({ data: [SAMPLE_EVENT], error: null });
    supabase.from.mockReturnValue(chain);

    const result = await getManualEventsForOwner(VALID_USER_ID, 'client');
    expect(result).toHaveLength(1);
  });

  it('returns empty array and warns for non-UUID owner', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await getManualEventsForOwner('bad-id', 'client');
    expect(result).toEqual([]);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// insertManualEvent
// ---------------------------------------------------------------------------

describe('insertManualEvent', () => {
  it('returns ok:true with the inserted event', async () => {
    const chain = makeChain({ data: SAMPLE_EVENT, error: null });
    supabase.from.mockReturnValue(chain);

    const res = await insertManualEvent({
      owner_id: VALID_USER_ID,
      owner_type: 'client',
      date: '2026-06-01',
      title: 'Team planning',
      organization_id: VALID_ORG_ID,
      created_by: VALID_USER_ID,
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.event.id).toBe(VALID_UUID);
  });

  it('returns ok:false for invalid date', async () => {
    const res = await insertManualEvent({
      owner_id: VALID_USER_ID,
      owner_type: 'client',
      date: 'not-a-date',
      title: 'Bad event',
    });
    expect(res.ok).toBe(false);
  });

  it('returns ok:false for non-UUID owner_id', async () => {
    const res = await insertManualEvent({
      owner_id: 'bad-id',
      owner_type: 'client',
      date: '2026-06-01',
      title: 'Bad owner',
    });
    expect(res.ok).toBe(false);
  });

  it('returns ok:false on supabase error', async () => {
    const chain = makeChain({ data: null, error: { message: 'insert error' } });
    supabase.from.mockReturnValue(chain);

    const res = await insertManualEvent({
      owner_id: VALID_USER_ID,
      owner_type: 'client',
      date: '2026-06-01',
      title: 'Event',
    });
    expect(res.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// updateManualEvent
// ---------------------------------------------------------------------------

describe('updateManualEvent', () => {
  it('returns true on successful update', async () => {
    const chain: Record<string, jest.Mock> = {};
    chain['update'] = jest.fn(() => chain);
    chain['eq']     = jest.fn(() => Promise.resolve({ error: null }));
    supabase.from.mockReturnValue(chain);

    const ok = await updateManualEvent(VALID_UUID, { title: 'Updated' });
    expect(ok).toBe(true);
  });

  it('returns false on supabase error', async () => {
    const chain: Record<string, jest.Mock> = {};
    chain['update'] = jest.fn(() => chain);
    chain['eq']     = jest.fn(() => Promise.resolve({ error: { message: 'fail' } }));
    supabase.from.mockReturnValue(chain);

    const ok = await updateManualEvent(VALID_UUID, { title: 'Updated' });
    expect(ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// deleteManualEvent
// ---------------------------------------------------------------------------

describe('deleteManualEvent', () => {
  it('returns true on successful delete', async () => {
    const chain: Record<string, jest.Mock> = {};
    chain['delete'] = jest.fn(() => chain);
    chain['eq']     = jest.fn(() => Promise.resolve({ error: null }));
    supabase.from.mockReturnValue(chain);

    const ok = await deleteManualEvent(VALID_UUID);
    expect(ok).toBe(true);
  });

  it('returns false on error', async () => {
    const chain: Record<string, jest.Mock> = {};
    chain['delete'] = jest.fn(() => chain);
    chain['eq']     = jest.fn(() => Promise.resolve({ error: { message: 'fail' } }));
    supabase.from.mockReturnValue(chain);

    const ok = await deleteManualEvent(VALID_UUID);
    expect(ok).toBe(false);
  });
});
