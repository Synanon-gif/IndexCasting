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
    from.mockReturnValue({
      select: () => ({
        eq: () => ({
          order: jest.fn().mockResolvedValue({ data: [BASE_BOOKING], error: null }),
        }),
      }),
    });
    const result = await getBookingsForAgency('agency-1');
    expect(result).toHaveLength(1);
    expect(result[0].agency_id).toBe('agency-1');
  });

  it('returns empty array on DB error', async () => {
    from.mockReturnValue({
      select: () => ({
        eq: () => ({
          order: jest.fn().mockResolvedValue({ data: null, error: { message: 'rls' } }),
        }),
      }),
    });
    const result = await getBookingsForAgency('agency-1');
    expect(result).toEqual([]);
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it('returns empty array when data is null without error', async () => {
    from.mockReturnValue({
      select: () => ({
        eq: () => ({
          order: jest.fn().mockResolvedValue({ data: null, error: null }),
        }),
      }),
    });
    const result = await getBookingsForAgency('agency-1');
    expect(result).toEqual([]);
  });
});

// ─── getBookingsForModel ──────────────────────────────────────────────────────

describe('getBookingsForModel', () => {
  it('returns bookings for a model', async () => {
    from.mockReturnValue({
      select: () => ({
        eq: () => ({
          order: jest.fn().mockResolvedValue({ data: [BASE_BOOKING], error: null }),
        }),
      }),
    });
    const result = await getBookingsForModel('model-1');
    expect(result).toHaveLength(1);
  });

  it('returns empty array on error', async () => {
    from.mockReturnValue({
      select: () => ({
        eq: () => ({
          order: jest.fn().mockResolvedValue({ data: null, error: { message: 'error' } }),
        }),
      }),
    });
    expect(await getBookingsForModel('model-1')).toEqual([]);
  });
});

// ─── getBookingsForClient ─────────────────────────────────────────────────────

describe('getBookingsForClient', () => {
  it('returns bookings for a client', async () => {
    from.mockReturnValue({
      select: () => ({
        eq: () => ({
          order: jest.fn().mockResolvedValue({ data: [BASE_BOOKING], error: null }),
        }),
      }),
    });
    expect(await getBookingsForClient('client-1')).toHaveLength(1);
  });

  it('returns empty array on error', async () => {
    from.mockReturnValue({
      select: () => ({
        eq: () => ({
          order: jest.fn().mockResolvedValue({ data: null, error: { message: 'rls' } }),
        }),
      }),
    });
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

describe('updateBookingStatus', () => {
  it('returns true on success', async () => {
    from.mockReturnValue({
      update: () => ({
        eq: jest.fn().mockResolvedValue({ error: null }),
      }),
    });
    expect(await updateBookingStatus('booking-1', 'completed')).toBe(true);
  });

  it('returns false on DB error', async () => {
    from.mockReturnValue({
      update: () => ({
        eq: jest.fn().mockResolvedValue({ error: { message: 'not found' } }),
      }),
    });
    expect(await updateBookingStatus('booking-1', 'cancelled')).toBe(false);
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it('handles all valid status transitions without throwing', async () => {
    const statuses: Booking['status'][] = ['confirmed', 'completed', 'cancelled', 'invoiced'];
    for (const status of statuses) {
      from.mockReturnValue({
        update: () => ({
          eq: jest.fn().mockResolvedValue({ error: null }),
        }),
      });
      expect(await updateBookingStatus('booking-1', status)).toBe(true);
    }
  });
});

// ─── getAgencyRevenue ─────────────────────────────────────────────────────────

describe('getAgencyRevenue', () => {
  it('calculates totals correctly from completed and invoiced bookings', async () => {
    const completedBooking: Booking = { ...BASE_BOOKING, status: 'completed', fee_total: 2000, commission_amount: 400 };
    const invoicedBooking: Booking  = { ...BASE_BOOKING, id: 'booking-2', status: 'invoiced', fee_total: 3000, commission_amount: 600 };
    const confirmedBooking: Booking = { ...BASE_BOOKING, id: 'booking-3', status: 'confirmed', fee_total: 5000, commission_amount: 1000 };

    from.mockReturnValue({
      select: () => ({
        eq: () => ({
          order: jest.fn().mockResolvedValue({
            data: [completedBooking, invoicedBooking, confirmedBooking],
            error: null,
          }),
        }),
      }),
    });

    const result = await getAgencyRevenue('agency-1');
    expect(result.booking_count).toBe(2);          // confirmed excluded
    expect(result.total_fees).toBe(5000);           // 2000 + 3000
    expect(result.total_commission).toBe(1000);     // 400 + 600
  });

  it('returns zeros when no bookings exist', async () => {
    from.mockReturnValue({
      select: () => ({
        eq: () => ({
          order: jest.fn().mockResolvedValue({ data: [], error: null }),
        }),
      }),
    });
    const result = await getAgencyRevenue('agency-1');
    expect(result).toEqual({ booking_count: 0, total_fees: 0, total_commission: 0 });
  });

  it('handles null fee_total and commission_amount gracefully', async () => {
    const nullFeeBooking: Booking = { ...BASE_BOOKING, status: 'completed', fee_total: null, commission_amount: null };
    from.mockReturnValue({
      select: () => ({
        eq: () => ({
          order: jest.fn().mockResolvedValue({ data: [nullFeeBooking], error: null }),
        }),
      }),
    });
    const result = await getAgencyRevenue('agency-1');
    expect(result.total_fees).toBe(0);
    expect(result.total_commission).toBe(0);
    expect(result.booking_count).toBe(1);
  });
});
