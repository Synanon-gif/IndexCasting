import { supabase } from '../../lib/supabase';

/**
 * Buchungen – in Supabase gespeichert, pro Partei abrufbar:
 * - Agentur: getBookingsForAgency(agencyId)
 * - Model: getBookingsForModel(modelId)
 * - Kunde: getBookingsForClient(clientId)
 * Ehemalige/abgeschlossene Buchungen bleiben in der Tabelle (status: completed, invoiced, cancelled).
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

export async function getBookingsForAgency(agencyId: string): Promise<Booking[]> {
  const { data, error } = await supabase
    .from('bookings')
    .select('*')
    .eq('agency_id', agencyId)
    .order('booking_date', { ascending: false });
  if (error) { console.error('getBookingsForAgency error:', error); return []; }
  return (data ?? []) as Booking[];
}

export async function getBookingsForModel(modelId: string): Promise<Booking[]> {
  const { data, error } = await supabase
    .from('bookings')
    .select('*')
    .eq('model_id', modelId)
    .order('booking_date', { ascending: false });
  if (error) { console.error('getBookingsForModel error:', error); return []; }
  return (data ?? []) as Booking[];
}

/** Ehemalige und laufende Buchungen des Kunden – aus Supabase, pro client_id. */
export async function getBookingsForClient(clientId: string): Promise<Booking[]> {
  const { data, error } = await supabase
    .from('bookings')
    .select('*')
    .eq('client_id', clientId)
    .order('booking_date', { ascending: false });
  if (error) { console.error('getBookingsForClient error:', error); return []; }
  return (data ?? []) as Booking[];
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
  return data as Booking;
}

export async function updateBookingStatus(
  bookingId: string,
  status: 'confirmed' | 'completed' | 'cancelled' | 'invoiced'
): Promise<boolean> {
  const { error } = await supabase
    .from('bookings')
    .update({ status })
    .eq('id', bookingId);
  if (error) { console.error('updateBookingStatus error:', error); return false; }
  return true;
}

export async function getAgencyRevenue(agencyId: string): Promise<{
  total_fees: number;
  total_commission: number;
  booking_count: number;
}> {
  const bookings = await getBookingsForAgency(agencyId);
  const completed = bookings.filter(b => b.status === 'completed' || b.status === 'invoiced');
  return {
    total_fees: completed.reduce((sum, b) => sum + (b.fee_total ?? 0), 0),
    total_commission: completed.reduce((sum, b) => sum + (b.commission_amount ?? 0), 0),
    booking_count: completed.length,
  };
}
