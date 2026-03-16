import { supabase } from '../../lib/supabase';
import type { SupabaseOptionRequest } from './optionRequestsSupabase';

export type CalendarEntryType =
  | 'personal'
  | 'gosee'
  | 'booking'
  | 'option'
  | 'casting';

export type BookingDetails = {
  client_notes?: string;
  agency_notes?: string;
  model_notes?: string;
  [key: string]: any;
};

export type CalendarEntry = {
  id: string;
  model_id: string;
  date: string;
  start_time: string | null;
  end_time: string | null;
  title: string | null;
  entry_type: CalendarEntryType;
  status: 'available' | 'blocked' | 'booked' | 'tentative';
  booking_id: string | null;
  note: string | null;
  created_at: string;
  created_by_agency?: boolean;
  option_request_id?: string | null;
  client_name?: string | null;
  booking_details?: BookingDetails | null;
};

export type ClientCalendarItem = {
  option: SupabaseOptionRequest;
  calendar_entry: CalendarEntry | null;
};

export type AgencyCalendarItem = {
  option: SupabaseOptionRequest;
  calendar_entry: CalendarEntry | null;
};

export async function getCalendarForModel(modelId: string): Promise<CalendarEntry[]> {
  const { data, error } = await supabase
    .from('calendar_entries')
    .select('*')
    .eq('model_id', modelId)
    .order('date', { ascending: true });
  if (error) { console.error('getCalendarForModel error:', error); return []; }
  return (data ?? []) as CalendarEntry[];
}

export async function getCalendarRange(
  modelId: string,
  startDate: string,
  endDate: string
): Promise<CalendarEntry[]> {
  const { data, error } = await supabase
    .from('calendar_entries')
    .select('*')
    .eq('model_id', modelId)
    .gte('date', startDate)
    .lte('date', endDate)
    .order('date', { ascending: true });
  if (error) { console.error('getCalendarRange error:', error); return []; }
  return (data ?? []) as CalendarEntry[];
}

export async function upsertCalendarEntry(
  modelId: string,
  date: string,
  status: 'available' | 'blocked' | 'booked' | 'tentative',
  note?: string,
  options?: {
    start_time?: string;
    end_time?: string;
    title?: string;
    entry_type?: CalendarEntryType;
    created_by_agency?: boolean;
    option_request_id?: string;
    client_name?: string;
    booking_details?: BookingDetails;
  }
): Promise<boolean> {
  const { error } = await supabase
    .from('calendar_entries')
    .upsert(
      {
        model_id: modelId,
        date,
        status,
        note: note || null,
        start_time: options?.start_time || null,
        end_time: options?.end_time || null,
        title: options?.title || null,
        entry_type: options?.entry_type || 'personal',
        created_by_agency: options?.created_by_agency ?? null,
        option_request_id: options?.option_request_id ?? null,
        client_name: options?.client_name ?? null,
        booking_details: options?.booking_details ?? null,
      },
      { onConflict: 'model_id,date' }
    );
  if (error) { console.error('upsertCalendarEntry error:', error); return false; }
  return true;
}

export async function insertCalendarEntry(
  modelId: string,
  date: string,
  status: 'available' | 'blocked' | 'booked' | 'tentative',
  options?: {
    start_time?: string;
    end_time?: string;
    title?: string;
    entry_type?: CalendarEntryType;
    note?: string;
    created_by_agency?: boolean;
    option_request_id?: string;
    client_name?: string;
    booking_details?: BookingDetails;
  }
): Promise<CalendarEntry | null> {
  const { data, error } = await supabase
    .from('calendar_entries')
    .insert({
      model_id: modelId,
      date,
      status,
      note: options?.note || null,
      start_time: options?.start_time || null,
      end_time: options?.end_time || null,
      title: options?.title || null,
      entry_type: options?.entry_type || 'personal',
      created_by_agency: options?.created_by_agency ?? null,
      option_request_id: options?.option_request_id ?? null,
      client_name: options?.client_name ?? null,
      booking_details: options?.booking_details ?? null,
    })
    .select()
    .single();
  if (error) { console.error('insertCalendarEntry error:', error); return null; }
  return data as CalendarEntry;
}

export async function deleteCalendarEntry(modelId: string, date: string): Promise<boolean> {
  const { error } = await supabase
    .from('calendar_entries')
    .delete()
    .eq('model_id', modelId)
    .eq('date', date);
  if (error) { console.error('deleteCalendarEntry error:', error); return false; }
  return true;
}

/** Set calendar entries linked to this option_request to Job (booking) type and title. */
export async function updateCalendarEntryToJob(optionRequestId: string): Promise<boolean> {
  const { data: rows, error: selErr } = await supabase
    .from('calendar_entries')
    .select('id, client_name')
    .eq('option_request_id', optionRequestId);
  if (selErr || !rows?.length) return !selErr;
  const clientName = (rows[0] as any).client_name || 'Client';
  const ids = rows.map((r: any) => r.id);
  const { error: updErr } = await supabase
    .from('calendar_entries')
    .update({ entry_type: 'booking', status: 'booked', title: `Job – ${clientName}` })
    .in('id', ids);
  if (updErr) { console.error('updateCalendarEntryToJob error:', updErr); return false; }
  return true;
}

export async function getCalendarEntriesForModel(modelId: string): Promise<CalendarEntry[]> {
  return getCalendarForModel(modelId);
}

/** Optionen/Jobs/Castings des Kunden – aus Supabase (option_requests + calendar_entries), pro client_id gespeichert. */
export async function getCalendarEntriesForClient(clientId: string): Promise<ClientCalendarItem[]> {
  const { data: options, error: optError } = await supabase
    .from('option_requests')
    .select('*')
    .eq('client_id', clientId)
    .order('requested_date', { ascending: true });
  if (optError) {
    console.error('getCalendarEntriesForClient options error:', optError);
    return [];
  }
  const optionList = (options ?? []) as SupabaseOptionRequest[];
  if (optionList.length === 0) return [];

  const optionIds = optionList.map((o) => o.id);
  const { data: entries, error: calError } = await supabase
    .from('calendar_entries')
    .select('*')
    .in('option_request_id', optionIds);
  if (calError) {
    console.error('getCalendarEntriesForClient calendar error:', calError);
  }
  const entryList = (entries ?? []) as CalendarEntry[];

  return optionList.map((opt) => ({
    option: opt,
    calendar_entry: entryList.find((e) => e.option_request_id === opt.id) ?? null,
  }));
}

/** Optionen/Jobs/Castings der Agentur – aus Supabase (option_requests + calendar_entries), pro agency_id gespeichert. */
export async function getCalendarEntriesForAgency(agencyId: string): Promise<AgencyCalendarItem[]> {
  const { data: options, error: optError } = await supabase
    .from('option_requests')
    .select('*')
    .eq('agency_id', agencyId)
    .order('requested_date', { ascending: true });
  if (optError) {
    console.error('getCalendarEntriesForAgency options error:', optError);
    return [];
  }
  const optionList = (options ?? []) as SupabaseOptionRequest[];
  if (optionList.length === 0) return [];

  const optionIds = optionList.map((o) => o.id);
  const { data: entries, error: calError } = await supabase
    .from('calendar_entries')
    .select('*')
    .in('option_request_id', optionIds);
  if (calError) {
    console.error('getCalendarEntriesForAgency calendar error:', calError);
  }
  const entryList = (entries ?? []) as CalendarEntry[];

  return optionList.map((opt) => ({
    option: opt,
    calendar_entry: entryList.find((e) => e.option_request_id === opt.id) ?? null,
  }));
}

export async function updateBookingDetails(
  optionRequestId: string,
  partialDetails: Partial<BookingDetails>,
  role: 'client' | 'agency' | 'model'
): Promise<boolean> {
  // role is currently informational for auditing / future logic
  try {
    const { data, error } = await supabase
      .from('calendar_entries')
      .select('id, booking_details')
      .eq('option_request_id', optionRequestId);
    if (error) {
      console.error('updateBookingDetails select error:', error);
      return false;
    }
    const rows = data as { id: string; booking_details: any }[];
    if (!rows.length) return true;

    const updates = rows.map((row) => ({
      id: row.id,
      booking_details: {
        ...(row.booking_details || {}),
        ...partialDetails,
      } as BookingDetails,
    }));

    const { error: updError } = await supabase
      .from('calendar_entries')
      .upsert(updates, { onConflict: 'id' });
    if (updError) {
      console.error('updateBookingDetails update error:', updError);
      return false;
    }
    return true;
  } catch (e) {
    console.error('updateBookingDetails unexpected error:', e);
    return false;
  }
}

