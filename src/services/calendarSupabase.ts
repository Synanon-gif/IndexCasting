import { supabase } from '../../lib/supabase';
import { OPTION_REQUEST_SELECT } from './optionRequestsSupabase';
import type { SupabaseOptionRequest } from './optionRequestsSupabase';

/** Alle Felder der calendar_entries-Tabelle — kein SELECT * mehr. */
const CALENDAR_ENTRY_SELECT =
  'id, model_id, date, start_time, end_time, title, entry_type, status, booking_id, note, created_at, created_by_agency, option_request_id, client_name, booking_details' as const;
import {
  getBookingEventsForOrg,
  getBookingEventsInRange,
  type BookingEvent,
  type BookingEventStatus,
} from './bookingEventsSupabase';
import type { BookingBrief } from '../utils/bookingBrief';

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.trim());
}

/**
 * Splits an array into chunks of at most `size` elements.
 * Used to prevent Supabase REST URL-length overflow when passing large IN-clause arrays.
 */
function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

export type CalendarEntryType =
  | 'personal'
  | 'gosee'
  | 'booking'
  | 'option'
  | 'casting';

/** Visible to client, agency, and model on the same booking (GDPR: party role + timestamp only, no extra PII). */
export type SharedBookingNote = {
  role: 'client' | 'agency' | 'model';
  at: string;
  text: string;
};

export type BookingDetails = {
  client_notes?: string;
  agency_notes?: string;
  model_notes?: string;
  /** Append-only timeline all parties can read in-app */
  shared_notes?: SharedBookingNote[];
  /** Structured production brief; visibility per field via scope (UI-enforced, same JSON trust as notes). */
  booking_brief?: BookingBrief;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

/**
 * Loads calendar entries for a model, scoped to a rolling date window.
 *
 * PERF-VULN-M2: added default date bounds (90 days back, 365 days forward)
 * to prevent unbounded fetches. For specific date ranges, use getCalendarRange().
 * Pass explicit startDate/endDate to override the defaults.
 */
export async function getCalendarForModel(
  modelId: string,
  opts?: { startDate?: string; endDate?: string },
): Promise<CalendarEntry[]> {
  try {
    const today = new Date();
    const defaultStart = new Date(today);
    defaultStart.setDate(defaultStart.getDate() - 90);
    const defaultEnd = new Date(today);
    defaultEnd.setDate(defaultEnd.getDate() + 365);

    const startDate = opts?.startDate ?? defaultStart.toISOString().slice(0, 10);
    const endDate   = opts?.endDate   ?? defaultEnd.toISOString().slice(0, 10);

    const { data, error } = await supabase
      .from('calendar_entries')
      .select(CALENDAR_ENTRY_SELECT)
      .eq('model_id', modelId)
      .gte('date', startDate)
      .lte('date', endDate)
      .order('date', { ascending: true });
    if (error) { console.error('getCalendarForModel error:', error); return []; }
    return (data ?? []) as CalendarEntry[];
  } catch (e) {
    console.error('getCalendarForModel exception:', e);
    return [];
  }
}

export async function getCalendarRange(
  modelId: string,
  startDate: string,
  endDate: string
): Promise<CalendarEntry[]> {
  try {
    const { data, error } = await supabase
      .from('calendar_entries')
      .select(CALENDAR_ENTRY_SELECT)
      .eq('model_id', modelId)
      .gte('date', startDate)
      .lte('date', endDate)
      .order('date', { ascending: true });
    if (error) { console.error('getCalendarRange error:', error); return []; }
    return (data ?? []) as CalendarEntry[];
  } catch (e) {
    console.error('getCalendarRange exception:', e);
    return [];
  }
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
    note?: string;
  }
): Promise<boolean> {
  const rowPayload = {
    model_id: modelId,
    date,
    status,
    note: (note ?? options?.note) || null,
    start_time: options?.start_time || null,
    end_time: options?.end_time || null,
    title: options?.title || null,
    entry_type: options?.entry_type || 'personal',
    created_by_agency: options?.created_by_agency ?? null,
    option_request_id: options?.option_request_id ?? null,
    client_name: options?.client_name ?? null,
    booking_details: options?.booking_details ?? null,
  };
  try {
    if (options?.option_request_id) {
      const { data: existing, error: selErr } = await supabase
        .from('calendar_entries')
        .select('id')
        .eq('option_request_id', options.option_request_id)
        .maybeSingle();
      if (selErr) {
        console.error('upsertCalendarEntry select option error:', selErr);
        return false;
      }
      if (existing?.id) {
        const { error } = await supabase.from('calendar_entries').update(rowPayload).eq('id', existing.id);
        if (error) {
          console.error('upsertCalendarEntry update option row error:', error);
          return false;
        }
        return true;
      }
    } else {
      const { data: existing, error: selErr } = await supabase
        .from('calendar_entries')
        .select('id')
        .eq('model_id', modelId)
        .eq('date', date)
        .is('option_request_id', null)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (selErr) {
        console.error('upsertCalendarEntry select personal error:', selErr);
        return false;
      }
      if (existing?.id) {
        const { error } = await supabase.from('calendar_entries').update(rowPayload).eq('id', existing.id);
        if (error) {
          console.error('upsertCalendarEntry update personal error:', error);
          return false;
        }
        return true;
      }
    }
    const inserted = await insertCalendarEntry(modelId, date, status, {
      ...options,
      note: (note ?? options?.note) || undefined,
    });
    return inserted != null;
  } catch (e) {
    console.error('upsertCalendarEntry exception:', e);
    return false;
  }
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
  try {
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
  } catch (e) {
    console.error('insertCalendarEntry exception:', e);
    return null;
  }
}

/**
 * @deprecated This function deletes ALL calendar entries for a model on a given
 * date, which causes unintended data loss when multiple entry types coexist on
 * the same day (e.g. a personal block + an option).
 *
 * Use deleteCalendarEntryById instead — it targets a single row by its primary key.
 *
 * This implementation has been hardened to refuse bulk deletes: it looks up the
 * first matching row and delegates to deleteCalendarEntryById. If more than one
 * row exists on that date, only the oldest is removed and a warning is logged so
 * the caller can be migrated.
 */
export async function deleteCalendarEntry(modelId: string, date: string): Promise<boolean> {
  console.warn(
    'deleteCalendarEntry is deprecated and targets entries by ID now. Migrate to deleteCalendarEntryById.',
    { modelId, date },
  );
  try {
    const { data, error } = await supabase
      .from('calendar_entries')
      .select('id')
      .eq('model_id', modelId)
      .eq('date', date)
      .is('option_request_id', null)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error) { console.error('deleteCalendarEntry select error:', error); return false; }
    if (!data?.id) return true;
    return deleteCalendarEntryById(data.id);
  } catch (e) {
    console.error('deleteCalendarEntry exception:', e);
    return false;
  }
}

export async function updateCalendarEntryById(
  entryId: string,
  updates: Partial<
    Pick<CalendarEntry, 'date' | 'start_time' | 'end_time' | 'title' | 'note' | 'status'>
  >
): Promise<boolean> {
  if (!isUuid(entryId)) {
    console.error('updateCalendarEntryById: entryId must be a valid UUID');
    return false;
  }
  try {
    if (updates.date != null && !/^\d{4}-\d{2}-\d{2}$/.test(String(updates.date).trim())) {
      console.error('updateCalendarEntryById: invalid date');
      return false;
    }
    const { error } = await supabase.from('calendar_entries').update(updates).eq('id', entryId);
    if (error) {
      console.error('updateCalendarEntryById error:', error);
      return false;
    }
    return true;
  } catch (e) {
    console.error('updateCalendarEntryById exception:', e);
    return false;
  }
}

export async function deleteCalendarEntryById(entryId: string): Promise<boolean> {
  if (!isUuid(entryId)) {
    console.error('deleteCalendarEntryById: entryId must be a valid UUID');
    return false;
  }
  try {
    const { error } = await supabase.from('calendar_entries').delete().eq('id', entryId);
    if (error) {
      console.error('deleteCalendarEntryById error:', error);
      return false;
    }
    return true;
  } catch (e) {
    console.error('deleteCalendarEntryById exception:', e);
    return false;
  }
}

/** Set calendar entries linked to this option_request to Job (booking) type and title. */
export async function updateCalendarEntryToJob(optionRequestId: string): Promise<boolean> {
  try {
    const { data: rows, error: selErr } = await supabase
      .from('calendar_entries')
      .select('id, client_name')
      .eq('option_request_id', optionRequestId);
    if (selErr) { console.error('updateCalendarEntryToJob select error:', selErr); return false; }
    if (!rows?.length) return true;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const clientName = (rows[0] as any).client_name || 'Client';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ids = rows.map((r: any) => r.id);
    const { error: updErr } = await supabase
      .from('calendar_entries')
      .update({ entry_type: 'booking', status: 'booked', title: `Job – ${clientName}` })
      .in('id', ids);
    if (updErr) { console.error('updateCalendarEntryToJob update error:', updErr); return false; }
    return true;
  } catch (e) {
    console.error('updateCalendarEntryToJob exception:', e);
    return false;
  }
}

export async function getCalendarEntriesForModel(modelId: string): Promise<CalendarEntry[]> {
  return getCalendarForModel(modelId);
}

/**
 * Fetches calendar_entries in chunked IN-queries to avoid Supabase REST URL-length limits.
 * Supabase REST serialises IN-clauses as query params; >100 UUIDs risks exceeding ~8 KB header limits.
 */
async function fetchCalendarEntriesByOptionIds(optionIds: string[]): Promise<CalendarEntry[]> {
  if (optionIds.length === 0) return [];
  const chunks = chunkArray(optionIds, 100);
  const results = await Promise.all(
    chunks.map(async (chunk) => {
      const { data, error } = await supabase
        .from('calendar_entries')
        .select(CALENDAR_ENTRY_SELECT)
        .in('option_request_id', chunk);
      if (error) console.error('fetchCalendarEntriesByOptionIds chunk error:', error);
      return (data ?? []) as CalendarEntry[];
    }),
  );
  return results.flat();
}

/** Optionen/Jobs/Castings des Kunden – aus Supabase (option_requests + calendar_entries), pro client_id gespeichert. */
export async function getCalendarEntriesForClient(clientId: string): Promise<ClientCalendarItem[]> {
  if (!isUuid(clientId)) {
    console.warn('getCalendarEntriesForClient: clientId must be auth user UUID');
    return [];
  }
  try {
    const { data: options, error: optError } = await supabase
      .from('option_requests')
      .select(OPTION_REQUEST_SELECT)
      .eq('client_id', clientId)
      .order('requested_date', { ascending: true })
      .limit(500);
    if (optError) {
      console.error('getCalendarEntriesForClient options error:', optError);
      return [];
    }
    const optionList = (options ?? []) as SupabaseOptionRequest[];
    if (optionList.length === 0) return [];

    const optionIds = optionList.map((o) => o.id);
    const entryList = await fetchCalendarEntriesByOptionIds(optionIds);

    return optionList.map((opt) => ({
      option: opt,
      calendar_entry: entryList.find((e) => e.option_request_id === opt.id) ?? null,
    }));
  } catch (e) {
    console.error('getCalendarEntriesForClient exception:', e);
    return [];
  }
}

/** Optionen/Jobs/Castings der Agentur – aus Supabase (option_requests + calendar_entries), pro agency_id gespeichert. */
export async function getCalendarEntriesForAgency(agencyId: string): Promise<AgencyCalendarItem[]> {
  if (!isUuid(agencyId)) {
    console.warn('getCalendarEntriesForAgency: agencyId must be UUID');
    return [];
  }
  try {
    const { data: options, error: optError } = await supabase
      .from('option_requests')
      .select(OPTION_REQUEST_SELECT)
      .eq('agency_id', agencyId)
      .order('requested_date', { ascending: true })
      .limit(500);
    if (optError) {
      console.error('getCalendarEntriesForAgency options error:', optError);
      return [];
    }
    const optionList = (options ?? []) as SupabaseOptionRequest[];
    if (optionList.length === 0) return [];

    const optionIds = optionList.map((o) => o.id);
    const entryList = await fetchCalendarEntriesByOptionIds(optionIds);

    return optionList.map((opt) => ({
      option: opt,
      calendar_entry: entryList.find((e) => e.option_request_id === opt.id) ?? null,
    }));
  } catch (e) {
    console.error('getCalendarEntriesForAgency exception:', e);
    return [];
  }
}

/**
 * Append a note every party can see (stored in calendar_entries.booking_details.shared_notes).
 *
 * Concurrency guard: each row is updated with an optimistic lock on `updated_at`.
 * If a concurrent write has already changed the row, the guard fails and we
 * re-fetch before retrying (one retry). This prevents the classic read-modify-write
 * race where two simultaneous notes overwrite each other's append.
 */
export async function appendSharedBookingNote(
  optionRequestId: string,
  role: 'client' | 'agency' | 'model',
  text: string
): Promise<boolean> {
  const trimmed = text.trim();
  if (!trimmed) return false;

  const newNote: SharedBookingNote = {
    role,
    at: new Date().toISOString(),
    text: trimmed.slice(0, 4000),
  };

  const attemptAppend = async (): Promise<boolean> => {
    const { data, error } = await supabase
      .from('calendar_entries')
      .select('id, booking_details, updated_at')
      .eq('option_request_id', optionRequestId);
    if (error) {
      console.error('appendSharedBookingNote select error:', error);
      return false;
    }
    const rows = data as { id: string; booking_details: BookingDetails | null; updated_at: string }[];
    if (!rows.length) return false;

    let allUpdated = true;
    for (const row of rows) {
      const prev = Array.isArray(row.booking_details?.shared_notes)
        ? row.booking_details!.shared_notes!
        : [];
      const newDetails: BookingDetails = {
        ...(row.booking_details || {}),
        shared_notes: [...prev, newNote],
      };
      // Optimistic lock: only update if updated_at has not changed since we read it.
      const { data: updated, error: updError } = await supabase
        .from('calendar_entries')
        .update({ booking_details: newDetails })
        .eq('id', row.id)
        .eq('updated_at', row.updated_at)
        .select('id')
        .maybeSingle();
      if (updError) {
        console.error('appendSharedBookingNote update error:', updError);
        allUpdated = false;
      } else if (!updated?.id) {
        console.warn('appendSharedBookingNote: optimistic lock miss — concurrent write detected, will retry', row.id);
        allUpdated = false;
      }
    }
    return allUpdated;
  };

  try {
    const ok = await attemptAppend();
    if (!ok) {
      // One retry after a brief yield to allow the concurrent write to complete.
      await new Promise((r) => setTimeout(r, 120));
      return attemptAppend();
    }
    return true;
  } catch (e) {
    console.error('appendSharedBookingNote unexpected error:', e);
    return false;
  }
}

/**
 * Convert a BookingEvent into the CalendarEntry shape so calendar views
 * can render booking_events alongside legacy calendar_entries without
 * changing view logic.
 */
export function bookingEventToCalendarEntry(ev: BookingEvent): CalendarEntry {
  const statusMap: Record<BookingEventStatus, CalendarEntry['status']> = {
    pending: 'tentative',
    agency_accepted: 'tentative',
    model_confirmed: 'booked',
    completed: 'booked',
    cancelled: 'available',
  };
  const typeMap: Record<BookingEvent['type'], CalendarEntryType> = {
    option: 'option',
    job: 'booking',
    casting: 'casting',
  };
  return {
    id: `be:${ev.id}`,
    model_id: ev.model_id,
    date: ev.date,
    start_time: null,
    end_time: null,
    title: ev.title ?? null,
    entry_type: typeMap[ev.type],
    status: statusMap[ev.status as BookingEventStatus],
    booking_id: null,
    note: ev.note ?? null,
    created_at: ev.created_at,
    option_request_id: ev.source_option_request_id ?? null,
    booking_details: null,
  };
}

/**
 * Get all booking_events for an org as CalendarEntry objects (additive merge).
 * Prefixes id with 'be:' so UI can distinguish origin.
 */
export async function getBookingEventsAsCalendarEntries(
  orgId: string,
  role: 'agency' | 'client',
): Promise<CalendarEntry[]> {
  const events = await getBookingEventsForOrg(orgId, role);
  return events.map(bookingEventToCalendarEntry);
}

/**
 * Date-range variant for calendar month/week rendering.
 */
export async function getBookingEventsAsCalendarEntriesInRange(params: {
  orgId: string;
  role: 'agency' | 'client';
  startDate: string;
  endDate: string;
}): Promise<CalendarEntry[]> {
  const events = await getBookingEventsInRange(params);
  return events.map(bookingEventToCalendarEntry);
}

export async function updateBookingDetails(
  optionRequestId: string,
  partialDetails: Partial<BookingDetails>,
  _role: 'client' | 'agency' | 'model'
): Promise<boolean> {
  // _role is currently informational for auditing / future logic
  //
  // Concurrency guard: reads updated_at and uses it as an optimistic lock so
  // two simultaneous partial-update calls cannot silently overwrite each other.
  // On lock miss, one retry is attempted after a brief yield (same pattern as
  // appendSharedBookingNote).
  const attemptUpdate = async (): Promise<boolean> => {
    try {
      const { data, error } = await supabase
        .from('calendar_entries')
        .select('id, booking_details, updated_at')
        .eq('option_request_id', optionRequestId);
      if (error) {
        console.error('updateBookingDetails select error:', error);
        return false;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows = data as { id: string; booking_details: any; updated_at: string }[];
      if (!rows.length) return true;

      let allUpdated = true;
      for (const row of rows) {
        const merged: BookingDetails = {
          ...(row.booking_details || {}),
          ...partialDetails,
        };
        const { data: updated, error: updError } = await supabase
          .from('calendar_entries')
          .update({ booking_details: merged })
          .eq('id', row.id)
          .eq('updated_at', row.updated_at)
          .select('id')
          .maybeSingle();
        if (updError) {
          console.error('updateBookingDetails update error:', updError);
          allUpdated = false;
        } else if (!updated?.id) {
          console.warn('updateBookingDetails: optimistic lock miss on row', row.id);
          allUpdated = false;
        }
      }
      return allUpdated;
    } catch (e) {
      console.error('updateBookingDetails unexpected error:', e);
      return false;
    }
  };

  const ok = await attemptUpdate();
  if (!ok) {
    await new Promise((r) => setTimeout(r, 120));
    return attemptUpdate();
  }
  return true;
}

// ─── Conflict Detection ────────────────────────────────────────────────────────

export type ConflictResult = {
  has_conflict: boolean;
  conflicting_entries: Array<{
    id: string;
    entry_type: string;
    start_time: string | null;
    end_time: string | null;
    title: string | null;
  }>;
};

/**
 * Checks whether a model has existing calendar entries that overlap the given
 * date + time window. Returns { has_conflict: false } on error (fail-open:
 * conflict check is informational only, never blocks the user).
 */
export async function checkCalendarConflict(
  modelId: string,
  date: string,
  startTime: string | null,
  endTime: string | null,
): Promise<ConflictResult> {
  try {
    const { data, error } = await supabase.rpc('check_calendar_conflict', {
      p_model_id: modelId,
      p_date: date,
      p_start: startTime,
      p_end: endTime,
    });
    if (error) throw error;
    return data as ConflictResult;
  } catch (err) {
    console.error('[calendarSupabase] checkCalendarConflict error:', err);
    return { has_conflict: false, conflicting_entries: [] };
  }
}

