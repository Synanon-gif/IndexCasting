import { supabase } from '../../lib/supabase';
import { logBookingAction } from './gdprComplianceSupabase';
import { assertOrgContext } from '../utils/orgGuard';

/**
 * @deprecated Legacy bookings table — superseded by booking_events.
 *
 * MIGRATION PATH:
 *   The `bookings` table was the original financial ledger. The modern system
 *   uses `booking_events` (see bookingEventsSupabase.ts) which covers the full
 *   booking lifecycle with org-scoping, status transitions, and option-request
 *   linkage via `source_option_request_id`.
 *
 *   New code MUST use bookingEventsSupabase.ts exclusively.
 *   This file is retained for:
 *     1. Historical data read-back (agencies viewing old bookings).
 *     2. The `getAgencyRevenue` RPC which still aggregates `bookings` rows.
 *
 *   TODO: Once `booking_events` has financial columns (`fee_total`, `commission`),
 *   update `get_agency_revenue` RPC to use `booking_events` and drop this file.
 *
 * Buchungen – in Supabase gespeichert, pro Partei abrufbar:
 * - Agentur: getBookingsForAgency(agencyId)
 * - Model: getBookingsForModel(modelId)
 * - Kunde: getBookingsForClient(clientId)
 */
export type Booking = {
  id: string;
  model_id: string;
  agency_id: string;
  client_id: string | null;
  project_id: string | null;
  booking_date: string;
  end_date: string | null;
  fee_total: number | null;
  commission_rate: number | null;
  commission_amount: number | null;
  status: 'confirmed' | 'completed' | 'cancelled' | 'invoiced';
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type BookingListOptions = {
  /** Max rows per page. Defaults to 200 to cap transfer size. */
  limit?: number;
  /** Zero-based offset for pagination. Defaults to 0. */
  offset?: number;
};

export async function getBookingsForAgency(
  agencyId: string,
  opts?: BookingListOptions,
): Promise<Booking[]> {
  try {
    const limit = opts?.limit ?? 200;
    const offset = opts?.offset ?? 0;
    const { data, error } = await supabase
      .from('bookings')
      .select('*')
      .eq('agency_id', agencyId)
      .order('booking_date', { ascending: false })
      .range(offset, offset + limit - 1);
    if (error) { console.error('getBookingsForAgency error:', error); return []; }
    return (data ?? []) as Booking[];
  } catch (e) {
    console.error('getBookingsForAgency exception:', e);
    return [];
  }
}

export async function getBookingsForModel(
  modelId: string,
  opts?: BookingListOptions,
): Promise<Booking[]> {
  try {
    const limit = opts?.limit ?? 200;
    const offset = opts?.offset ?? 0;
    const { data, error } = await supabase
      .from('bookings')
      .select('*')
      .eq('model_id', modelId)
      .order('booking_date', { ascending: false })
      .range(offset, offset + limit - 1);
    if (error) { console.error('getBookingsForModel error:', error); return []; }
    return (data ?? []) as Booking[];
  } catch (e) {
    console.error('getBookingsForModel exception:', e);
    return [];
  }
}

/** Ehemalige und laufende Buchungen des Kunden – aus Supabase, pro client_id. */
export async function getBookingsForClient(
  clientId: string,
  opts?: BookingListOptions,
): Promise<Booking[]> {
  try {
    const limit = opts?.limit ?? 200;
    const offset = opts?.offset ?? 0;
    const { data, error } = await supabase
      .from('bookings')
      .select('*')
      .eq('client_id', clientId)
      .order('booking_date', { ascending: false })
      .range(offset, offset + limit - 1);
    if (error) { console.error('getBookingsForClient error:', error); return []; }
    return (data ?? []) as Booking[];
  } catch (e) {
    console.error('getBookingsForClient exception:', e);
    return [];
  }
}

export async function createBooking(booking: {
  model_id: string;
  agency_id: string;
  client_id?: string;
  project_id?: string;
  booking_date: string;
  end_date?: string;
  fee_total?: number;
  commission_rate?: number;
  notes?: string;
}): Promise<Booking | null> {
  const commissionAmount = (booking.fee_total && booking.commission_rate)
    ? (booking.fee_total * booking.commission_rate / 100)
    : null;

  const { data, error } = await supabase
    .from('bookings')
    .insert({
      ...booking,
      client_id: booking.client_id || null,
      project_id: booking.project_id || null,
      end_date: booking.end_date || null,
      fee_total: booking.fee_total || null,
      commission_rate: booking.commission_rate || 20.00,
      commission_amount: commissionAmount,
      notes: booking.notes || null,
    })
    .select()
    .single();
  if (error) { console.error('createBooking error:', error); return null; }
  const created = data as Booking;
  void logBookingAction(booking.agency_id, 'booking_created', created.id, {
    model_id: booking.model_id,
    client_id: booking.client_id,
    fee_total: booking.fee_total,
    booking_date: booking.booking_date,
  });
  return created;
}

export async function updateBookingStatus(
  bookingId: string,
  status: 'confirmed' | 'completed' | 'cancelled' | 'invoiced',
  fromStatus: 'pending' | 'confirmed' | 'completed' | 'cancelled' | 'invoiced',
): Promise<boolean> {
  try {
    // Optimistic concurrency guard: only the transition from the expected prior
    // state succeeds. Returns 0 rows if another request already changed the
    // status, preventing double-confirm / double-cancel races.
    const { data, error } = await supabase
      .from('bookings')
      .update({ status })
      .eq('id', bookingId)
      .eq('status', fromStatus)
      .select('id, agency_org_id, client_org_id');
    if (error) { console.error('updateBookingStatus error:', error); return false; }
    if (!data || data.length === 0) {
      console.warn('updateBookingStatus: no row updated — concurrent state change or wrong fromStatus', { bookingId, fromStatus, targetStatus: status });
      return false;
    }
    const row = data[0] as { id: string; agency_org_id: string | null; client_org_id: string | null };
    const orgId = row.agency_org_id ?? row.client_org_id;
    const auditAction = status === 'cancelled' ? 'booking_cancelled' : 'booking_confirmed';
    if (assertOrgContext(orgId, 'updateBookingStatus')) {
      void logBookingAction(orgId, auditAction, bookingId, { from: fromStatus, to: status });
    }
    return true;
  } catch (e) {
    console.error('updateBookingStatus exception:', e);
    return false;
  }
}

/**
 * Revenue aggregation via the get_agency_revenue() DB RPC.
 *
 * PERF-VULN-M7 fix: replaced JS-side reduce over an unbounded row fetch.
 * The RPC runs SUM() in Postgres and returns a single JSONB object — zero
 * network overhead from row serialisation regardless of booking count.
 * Requires migration_hardening_2026_04_final.sql.
 */
export async function getAgencyRevenue(agencyId: string): Promise<{
  total_fees: number;
  total_commission: number;
  booking_count: number;
}> {
  const empty = { total_fees: 0, total_commission: 0, booking_count: 0 };
  try {
    const { data, error } = await supabase.rpc('get_agency_revenue', {
      p_agency_id: agencyId,
    });
    if (error) {
      console.error('getAgencyRevenue RPC error:', error);
      return empty;
    }
    const result = data as { total_fees: number; total_commission: number; booking_count: number } | null;
    return {
      total_fees:       Number(result?.total_fees ?? 0),
      total_commission: Number(result?.total_commission ?? 0),
      booking_count:    Number(result?.booking_count ?? 0),
    };
  } catch (e) {
    console.error('getAgencyRevenue exception:', e);
    return empty;
  }
}
