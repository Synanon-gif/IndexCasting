/**
 * Tests für bookingsSupabase.ts (Legacy Bookings)
 *
 * Audit finding L-2: no test coverage for the legacy bookings service.
 * These tests cover: getBookingsForAgency, getBookingsForModel,
 * getBookingsForClient, createBooking, updateBookingStatus, getAgencyRevenue.
 */

jest.mock('../../../lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
    rpc:  jest.fn(),
  },
}));

import { supabase } from '../../../lib/supabase';
import {
  getBookingsForAgency,
  getBookingsForModel,
  getBookingsForClient,
  createBooking,
  updateBookingStatus,
  getAgencyRevenue,
  type Booking,
} from '../bookingsSupabase';

const from = supabase.from as jest.Mock;
const rpc  = supabase.rpc  as jest.Mock;

/** Builds a paginated chain: select → eq → order → range (terminal). */
const pageChain = (result: unknown) => ({
  select: () => ({
    eq: () => ({
      order: () => ({
        range: jest.fn().mockResolvedValue(result),
      }),
    }),
  }),
});

const BASE_BOOKING: Booking = {
  id:                'booking-1',
  model_id:          'model-1',
  agency_id:         'agency-1',
  client_id:         'client-1',
  project_id:        null,
  booking_date:      '2026-04-15',
  end_date:          null,
  fee_total:         3000,
  commission_rate:   20,
  commission_amount: 600,
  status:            'confirmed',
  notes:             null,
  created_at:        '2026-04-01T10:00:00Z',
  updated_at:        '2026-04-01T10:00:00Z',
};

let consoleErrorSpy: jest.SpyInstance;

beforeEach(() => {
  jest.resetAllMocks();
  consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  consoleErrorSpy.mockRestore();
});

// ─── getBookingsForAgency ─────────────────────────────────────────────────────

describe('getBookingsForAgency', () => {
  it('returns bookings array on success', async () => {
    from.mockReturnValue(pageChain({ data: [BASE_BOOKING], error: null }));
    const result = await getBookingsForAgency('agency-1');
    expect(result).toHaveLength(1);
    expect(result[0].agency_id).toBe('agency-1');
  });

  it('returns empty array on DB error', async () => {
    from.mockReturnValue(pageChain({ data: null, error: { message: 'rls' } }));
    const result = await getBookingsForAgency('agency-1');
    expect(result).toEqual([]);
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it('returns empty array when data is null without error', async () => {
    from.mockReturnValue(pageChain({ data: null, error: null }));
    expect(await getBookingsForAgency('agency-1')).toEqual([]);
  });
});

// ─── getBookingsForModel ──────────────────────────────────────────────────────

describe('getBookingsForModel', () => {
  it('returns bookings for a model', async () => {
    from.mockReturnValue(pageChain({ data: [BASE_BOOKING], error: null }));
    expect(await getBookingsForModel('model-1')).toHaveLength(1);
  });

  it('returns empty array on error', async () => {
    from.mockReturnValue(pageChain({ data: null, error: { message: 'error' } }));
    expect(await getBookingsForModel('model-1')).toEqual([]);
  });
});

// ─── getBookingsForClient ─────────────────────────────────────────────────────

describe('getBookingsForClient', () => {
  it('returns bookings for a client', async () => {
    from.mockReturnValue(pageChain({ data: [BASE_BOOKING], error: null }));
    expect(await getBookingsForClient('client-1')).toHaveLength(1);
  });

  it('returns empty array on error', async () => {
    from.mockReturnValue(pageChain({ data: null, error: { message: 'rls' } }));
    expect(await getBookingsForClient('client-1')).toEqual([]);
  });
});

// ─── createBooking ────────────────────────────────────────────────────────────

describe('createBooking', () => {
  it('creates a booking and returns it', async () => {
    from.mockReturnValue({
      insert: () => ({
        select: () => ({
          single: jest.fn().mockResolvedValue({ data: BASE_BOOKING, error: null }),
        }),
      }),
    });
    const result = await createBooking({
      model_id:     'model-1',
      agency_id:    'agency-1',
      booking_date: '2026-04-15',
      fee_total:    3000,
      commission_rate: 20,
    });
    expect(result).not.toBeNull();
    expect(result?.id).toBe('booking-1');
  });

  it('calculates commission_amount correctly', async () => {
    let insertedPayload: Record<string, unknown> = {};
    from.mockReturnValue({
      insert: (payload: Record<string, unknown>) => {
        insertedPayload = payload;
        return {
          select: () => ({
            single: jest.fn().mockResolvedValue({ data: BASE_BOOKING, error: null }),
          }),
        };
      },
    });
    await createBooking({
      model_id:        'model-1',
      agency_id:       'agency-1',
      booking_date:    '2026-04-15',
      fee_total:       5000,
      commission_rate: 20,
    });
    expect(insertedPayload.commission_amount).toBe(1000); // 5000 * 20 / 100
  });

  it('sets commission_amount to null when fee_total is missing', async () => {
    let insertedPayload: Record<string, unknown> = {};
    from.mockReturnValue({
      insert: (payload: Record<string, unknown>) => {
        insertedPayload = payload;
        return {
          select: () => ({
            single: jest.fn().mockResolvedValue({ data: { ...BASE_BOOKING, fee_total: null }, error: null }),
          }),
        };
      },
    });
    await createBooking({
      model_id:     'model-1',
      agency_id:    'agency-1',
      booking_date: '2026-04-15',
    });
    expect(insertedPayload.commission_amount).toBeNull();
  });

  it('returns null on DB error', async () => {
    from.mockReturnValue({
      insert: () => ({
        select: () => ({
          single: jest.fn().mockResolvedValue({ data: null, error: { message: 'constraint violation' } }),
        }),
      }),
    });
    const result = await createBooking({
      model_id:     'model-1',
      agency_id:    'agency-1',
      booking_date: '2026-04-15',
    });
    expect(result).toBeNull();
    expect(consoleErrorSpy).toHaveBeenCalled();
  });
});

// ─── updateBookingStatus ──────────────────────────────────────────────────────

/** Creates a self-referencing eq mock chain that also exposes a select method. */
function makeEqChain(selectResult: { data: unknown; error: unknown }) {
  const selectMock = jest.fn().mockResolvedValue(selectResult);
  // eslint-disable-next-line prefer-const
  let eqMock: jest.Mock;
  eqMock = jest.fn().mockImplementation(() => ({ eq: eqMock, select: selectMock }));
  return eqMock;
}

describe('updateBookingStatus', () => {
  it('returns true on success', async () => {
    from.mockReturnValue({
      update: () => ({ eq: makeEqChain({ data: [{ id: 'booking-1' }], error: null }) }),
    });
    expect(await updateBookingStatus('booking-1', 'completed')).toBe(true);
  });

  it('returns false on DB error', async () => {
    from.mockReturnValue({
      update: () => ({ eq: makeEqChain({ data: null, error: { message: 'not found' } }) }),
    });
    expect(await updateBookingStatus('booking-1', 'cancelled')).toBe(false);
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it('returns false when no row updated (concurrent state change)', async () => {
    from.mockReturnValue({
      update: () => ({ eq: makeEqChain({ data: [], error: null }) }),
    });
    expect(await updateBookingStatus('booking-1', 'confirmed', 'pending')).toBe(false);
  });

  it('handles all valid status transitions without throwing', async () => {
    const statuses: Booking['status'][] = ['confirmed', 'completed', 'cancelled', 'invoiced'];
    for (const status of statuses) {
      from.mockReturnValue({
        update: () => ({ eq: makeEqChain({ data: [{ id: 'booking-1' }], error: null }) }),
      });
      expect(await updateBookingStatus('booking-1', status)).toBe(true);
    }
  });
});

// ─── getAgencyRevenue ─────────────────────────────────────────────────────────
// PERF-VULN-M7 fix: getAgencyRevenue now calls the get_agency_revenue RPC
// instead of loading all rows and reducing in JS. Tests verify RPC usage.

describe('getAgencyRevenue', () => {
  it('returns aggregated totals from the RPC (not from())', async () => {
    rpc.mockResolvedValue({
      data: { total_fees: 5000, total_commission: 1000, booking_count: 2 },
      error: null,
    });
    const result = await getAgencyRevenue('agency-1');
    expect(rpc).toHaveBeenCalledWith('get_agency_revenue', { p_agency_id: 'agency-1' });
    expect(from).not.toHaveBeenCalled();
    expect(result.booking_count).toBe(2);
    expect(result.total_fees).toBe(5000);
    expect(result.total_commission).toBe(1000);
  });

  it('returns zeros when RPC returns null data (no bookings)', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    const result = await getAgencyRevenue('agency-1');
    expect(result).toEqual({ booking_count: 0, total_fees: 0, total_commission: 0 });
  });

  it('returns zeros on RPC error (fail-safe)', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'unauthorized' } });
    const result = await getAgencyRevenue('agency-1');
    expect(result).toEqual({ booking_count: 0, total_fees: 0, total_commission: 0 });
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it('returns zeros on exception', async () => {
    rpc.mockImplementation(() => { throw new Error('network'); });
    const result = await getAgencyRevenue('agency-1');
    expect(result).toEqual({ booking_count: 0, total_fees: 0, total_commission: 0 });
    expect(consoleErrorSpy).toHaveBeenCalled();
  });
});
