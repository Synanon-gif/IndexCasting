/**
 * Tests for bookingEventsSupabase.ts
 * Covers: createBookingEvent, updateBookingEventStatus (transitions), bookingStatusLabel,
 *         getBookingEventsForModel, getBookingEventsForOrg
 */
import {
  createBookingEvent,
  createConfirmedBookingEvent,
  updateBookingEventStatus,
  getBookingEventsForModel,
  getBookingEventsForOrg,
  bookingStatusLabel,
  type BookingEvent,
  type BookingEventStatus,
} from '../bookingEventsSupabase';

// ---------------------------------------------------------------------------
// Supabase mock
// ---------------------------------------------------------------------------
const _insertMock = jest.fn();
const _selectMock = jest.fn();
const _eqMock = jest.fn();
const _updateMock = jest.fn();
const _maybeSingleMock = jest.fn();
const _orderMock = jest.fn();
const _singleMock = jest.fn();
const getUserMock = jest.fn();

const makeChain = (finalResult: unknown) => {
  const chain: Record<string, jest.Mock> = {};
  const methods = [
    'select',
    'insert',
    'update',
    'eq',
    'neq',
    'order',
    'maybeSingle',
    'single',
    'gte',
    'lte',
    'in',
    'not',
  ];
  methods.forEach((m) => {
    chain[m] = jest.fn(() => {
      if (m === 'maybeSingle' || m === 'single') return Promise.resolve(finalResult);
      return chain;
    });
  });
  return chain;
};

jest.mock('../../../lib/supabase', () => ({
  supabase: {
    auth: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      getUser: (...args: any[]) => getUserMock(...args),
    },
    from: jest.fn(),
  },
}));

import { supabase } from '../../../lib/supabase';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const makeEvent = (overrides?: Partial<BookingEvent>): BookingEvent => ({
  id: 'evt-1',
  model_id: 'model-1',
  client_org_id: 'client-org-1',
  agency_org_id: 'agency-org-1',
  date: '2026-05-01',
  type: 'option',
  status: 'pending',
  title: null,
  note: null,
  source_option_request_id: null,
  created_by: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  ...overrides,
});

// ---------------------------------------------------------------------------
// bookingStatusLabel
// ---------------------------------------------------------------------------
describe('bookingStatusLabel', () => {
  const cases: Array<[BookingEventStatus, string]> = [
    ['pending', 'Pending'],
    ['agency_accepted', 'Agency Accepted'],
    ['model_confirmed', 'Model Confirmed'],
    ['completed', 'Completed'],
    ['cancelled', 'Cancelled'],
  ];

  test.each(cases)('status %s → label %s', (status, expected) => {
    expect(bookingStatusLabel(status)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// createBookingEvent
// ---------------------------------------------------------------------------
describe('createBookingEvent', () => {
  beforeEach(() => jest.clearAllMocks());

  it('inserts a new event and returns it', async () => {
    const event = makeEvent();
    getUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } } });

    const chain = makeChain({ data: event, error: null });
    (supabase.from as jest.Mock).mockReturnValue(chain);
    chain.insert.mockReturnValue(chain);
    chain.select.mockReturnValue(chain);
    chain.single.mockResolvedValue({ data: event, error: null });

    const result = await createBookingEvent({
      model_id: 'model-1',
      agency_org_id: 'agency-org-1',
      client_org_id: 'client-org-1',
      date: '2026-05-01',
      type: 'option',
    });

    expect(result).not.toBeNull();
    expect(result?.status).toBe('pending');
    expect(result?.model_id).toBe('model-1');
  });

  it('returns null on supabase error', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    const chain = makeChain({ data: null, error: { message: 'DB error' } });
    (supabase.from as jest.Mock).mockReturnValue(chain);
    chain.insert.mockReturnValue(chain);
    chain.select.mockReturnValue(chain);
    chain.single.mockResolvedValue({ data: null, error: { message: 'DB error' } });

    const result = await createBookingEvent({
      model_id: 'model-1',
      date: '2026-05-01',
      type: 'option',
    });

    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// createConfirmedBookingEvent — parity with optionRequestAttention availability gate
// (!modelAccountLinked || modelApproval === 'approved')
// ---------------------------------------------------------------------------
describe('createConfirmedBookingEvent', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns null and does not insert when model is linked and approval is pending', async () => {
    const result = await createConfirmedBookingEvent({
      model_id: 'model-1',
      agency_org_id: 'agency-org-1',
      client_org_id: 'client-org-1',
      date: '2026-05-01',
      type: 'option',
      modelAccountLinked: true,
      modelApproval: 'pending',
    });
    expect(result).toBeNull();
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('returns null without insert when model is linked and approval is rejected', async () => {
    const result = await createConfirmedBookingEvent({
      model_id: 'model-1',
      date: '2026-05-01',
      type: 'option',
      modelAccountLinked: true,
      modelApproval: 'rejected',
    });
    expect(result).toBeNull();
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('inserts when model is not linked (agency-only confirmation path)', async () => {
    const event = makeEvent();
    getUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    const chain = makeChain({ data: event, error: null });
    (supabase.from as jest.Mock).mockReturnValue(chain);
    chain.insert.mockReturnValue(chain);
    chain.select.mockReturnValue(chain);
    chain.single.mockResolvedValue({ data: event, error: null });

    const result = await createConfirmedBookingEvent({
      model_id: 'model-1',
      agency_org_id: 'agency-org-1',
      date: '2026-05-01',
      type: 'option',
      modelAccountLinked: false,
      modelApproval: 'pending',
    });

    expect(result).not.toBeNull();
    expect(supabase.from).toHaveBeenCalledWith('booking_events');
  });

  it('inserts when model is linked and approval is approved', async () => {
    const event = makeEvent();
    getUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    const chain = makeChain({ data: event, error: null });
    (supabase.from as jest.Mock).mockReturnValue(chain);
    chain.insert.mockReturnValue(chain);
    chain.select.mockReturnValue(chain);
    chain.single.mockResolvedValue({ data: event, error: null });

    const result = await createConfirmedBookingEvent({
      model_id: 'model-1',
      date: '2026-05-01',
      type: 'option',
      modelAccountLinked: true,
      modelApproval: 'approved',
    });

    expect(result).not.toBeNull();
    expect(supabase.from).toHaveBeenCalledWith('booking_events');
  });
});

// ---------------------------------------------------------------------------
// updateBookingEventStatus – transitions
// ---------------------------------------------------------------------------
describe('updateBookingEventStatus', () => {
  beforeEach(() => jest.clearAllMocks());

  /**
   * Builds a mock for the UPDATE path that matches the optimistic-lock chain:
   *   .update(payload).eq('id', id).eq('status', currentStatus).select('id')
   * resolving to { data, error }.
   */
  const makeUpdateChain = (result: { data: unknown; error: unknown }) => {
    const selectFn = jest.fn().mockResolvedValue(result);
    const eq2Fn = jest.fn().mockReturnValue({ select: selectFn });
    const eq1Fn = jest.fn().mockReturnValue({ eq: eq2Fn });
    const updateFn = jest.fn().mockReturnValue({ eq: eq1Fn });
    return { update: updateFn };
  };

  it('allows valid transition pending → agency_accepted', async () => {
    // First from() call: fetch current status
    const fetchChain = makeChain(null);
    fetchChain.maybeSingle.mockResolvedValue({ data: { status: 'pending' }, error: null });

    // Second from() call: optimistic-lock update returning 1 row
    const updateMock = makeUpdateChain({ data: [{ id: 'evt-1' }], error: null });

    (supabase.from as jest.Mock).mockReturnValueOnce(fetchChain).mockReturnValueOnce(updateMock);

    const result = await updateBookingEventStatus('evt-1', 'agency_accepted');
    expect(result.ok).toBe(true);
  });

  it('returns false when optimistic lock fires (0 rows updated — concurrent write)', async () => {
    const fetchChain = makeChain(null);
    fetchChain.maybeSingle.mockResolvedValue({ data: { status: 'pending' }, error: null });

    // 0 rows updated → another caller changed the status first
    const updateMock = makeUpdateChain({ data: [], error: null });

    (supabase.from as jest.Mock).mockReturnValueOnce(fetchChain).mockReturnValueOnce(updateMock);

    const result = await updateBookingEventStatus('evt-1', 'agency_accepted');
    expect(result.ok).toBe(false);
  });

  it('rejects invalid transition pending → model_confirmed', async () => {
    const chain = makeChain({ data: { status: 'pending' }, error: null });
    (supabase.from as jest.Mock).mockReturnValue(chain);

    const result = await updateBookingEventStatus('evt-1', 'model_confirmed');
    expect(result.ok).toBe(false);
    expect(result.message).toContain('Cannot transition');
  });

  it('rejects transition from completed (terminal state)', async () => {
    const chain = makeChain({ data: { status: 'completed' }, error: null });
    (supabase.from as jest.Mock).mockReturnValue(chain);

    const result = await updateBookingEventStatus('evt-1', 'agency_accepted');
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getBookingEventsForModel
// ---------------------------------------------------------------------------
describe('getBookingEventsForModel', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns events for a model', async () => {
    const events = [makeEvent(), makeEvent({ id: 'evt-2' })];
    const chain = makeChain(null);
    chain.select.mockReturnValue(chain);
    chain.eq.mockReturnValue(chain);
    chain.gte.mockReturnValue(chain);
    chain.lte.mockReturnValue(chain);
    chain.order.mockReturnValue(chain);
    // BUG-10 fix: chain now ends with .limit()
    chain.limit = jest.fn(() => Promise.resolve({ data: events, error: null }));
    (supabase.from as jest.Mock).mockReturnValue(chain);

    const result = await getBookingEventsForModel('model-1');
    expect(result).toHaveLength(2);
  });

  it('returns empty array on error', async () => {
    const chain = makeChain(null);
    chain.select.mockReturnValue(chain);
    chain.eq.mockReturnValue(chain);
    chain.gte.mockReturnValue(chain);
    chain.lte.mockReturnValue(chain);
    chain.order.mockReturnValue(chain);
    chain.limit = jest.fn(() => Promise.resolve({ data: null, error: { message: 'fail' } }));
    (supabase.from as jest.Mock).mockReturnValue(chain);

    const result = await getBookingEventsForModel('model-1');
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getBookingEventsForOrg
// ---------------------------------------------------------------------------
describe('getBookingEventsForOrg', () => {
  beforeEach(() => jest.clearAllMocks());

  it('queries by agency_org_id for role=agency', async () => {
    const events = [makeEvent()];
    const chain = makeChain(null);
    chain.select.mockReturnValue(chain);
    chain.eq.mockReturnValue(chain);
    chain.gte.mockReturnValue(chain);
    chain.lte.mockReturnValue(chain);
    chain.order.mockReturnValue(chain);
    // BUG-10 fix: chain now ends with .limit() not .order()
    chain.limit = jest.fn(() => Promise.resolve({ data: events, error: null }));
    (supabase.from as jest.Mock).mockReturnValue(chain);

    const result = await getBookingEventsForOrg('org-1', 'agency');
    expect(chain.eq).toHaveBeenCalledWith('agency_org_id', 'org-1');
    expect(result).toHaveLength(1);
  });

  it('queries by client_org_id for role=client', async () => {
    const events = [makeEvent()];
    const chain = makeChain(null);
    chain.select.mockReturnValue(chain);
    chain.eq.mockReturnValue(chain);
    chain.gte.mockReturnValue(chain);
    chain.lte.mockReturnValue(chain);
    chain.order.mockReturnValue(chain);
    chain.limit = jest.fn(() => Promise.resolve({ data: events, error: null }));
    (supabase.from as jest.Mock).mockReturnValue(chain);

    await getBookingEventsForOrg('org-2', 'client');
    expect(chain.eq).toHaveBeenCalledWith('client_org_id', 'org-2');
  });
});
