import { supabase } from '../../lib/supabase';
import { uiCopy } from '../constants/uiCopy';

/** Explizite Feldliste — kein SELECT * mehr (verhindert ungewollten Datenabfluss bei neuen Spalten). */
const USER_CALENDAR_EVENT_SELECT =
  'id, owner_id, owner_type, date, start_time, end_time, title, color, note, organization_id, created_by, source_option_request_id, reminder_at, created_at, updated_at' as const;

/**
 * Manuelle Kalender-Ereignisse – pro Partei (Kunde/Agentur) in Supabase gespeichert.
 * Nur die jeweilige Partei sieht und verwaltet ihre eigenen Events (RLS).
 */
export type UserCalendarEvent = {
  id: string;
  owner_id: string;
  owner_type: 'client' | 'agency';
  date: string;
  start_time: string | null;
  end_time: string | null;
  title: string;
  color: string;
  note: string | null;
  organization_id: string | null;
  created_by: string | null;
  /** Populated by DB trigger when this event was mirrored from an option_request. */
  source_option_request_id: string | null;
  /** Optional in-app reminder timestamp. NULL = no reminder. */
  reminder_at?: string | null;
  created_at: string;
  updated_at: string;
};

const DEFAULT_COLORS = ['#1565C0', '#2E7D32', '#F9A825', '#C62828', '#6A1B9A', '#00838F'];

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.trim());
}

export async function getManualEventsForOwner(
  ownerId: string,
  ownerType: 'client' | 'agency'
): Promise<UserCalendarEvent[]> {
  if (!isUuid(ownerId)) {
    console.warn('getManualEventsForOwner: ownerId must be a UUID (use auth user id / agency id)');
    return [];
  }
  const { data, error } = await supabase
    .from('user_calendar_events')
    .select(USER_CALENDAR_EVENT_SELECT)
    .eq('owner_id', ownerId)
    .eq('owner_type', ownerType)
    .order('date', { ascending: true })
    .order('start_time', { ascending: true });
  if (error) {
    console.error('getManualEventsForOwner error:', error);
    return [];
  }
  return (data ?? []) as UserCalendarEvent[];
}

/**
 * Fetch all manual calendar events for an organisation (org-wide shared view).
 * Uses the `organization_id` column so every org member sees the same set of
 * events regardless of who originally created them.
 *
 * RLS enforces that the calling user is actually a member of `orgId`.
 */
export async function getManualEventsForOrg(
  orgId: string,
  ownerType: 'client' | 'agency'
): Promise<UserCalendarEvent[]> {
  if (!isUuid(orgId)) {
    console.warn('getManualEventsForOrg: orgId must be a valid UUID');
    return [];
  }
  try {
    const { data, error } = await supabase
      .from('user_calendar_events')
      .select(USER_CALENDAR_EVENT_SELECT)
      .eq('organization_id', orgId)
      .eq('owner_type', ownerType)
      .order('date', { ascending: true })
      .order('start_time', { ascending: true });
    if (error) {
      console.error('getManualEventsForOrg error:', error);
      return [];
    }
    return (data ?? []) as UserCalendarEvent[];
  } catch (e) {
    console.error('getManualEventsForOrg exception:', e);
    return [];
  }
}

export type InsertManualEventResult =
  | { ok: true; event: UserCalendarEvent }
  | { ok: false; errorMessage: string; isDuplicate?: boolean };

export async function insertManualEvent(event: {
  owner_id: string;
  owner_type: 'client' | 'agency';
  date: string;
  start_time?: string;
  end_time?: string;
  title: string;
  color?: string;
  note?: string;
  organization_id?: string | null;
  created_by?: string | null;
  reminder_at?: string | null;
}): Promise<InsertManualEventResult> {
  try {
    if (!isUuid(event.owner_id)) {
      return {
        ok: false,
        errorMessage: uiCopy.alerts.invalidOwnerId,
      };
    }
    const dateNorm = event.date.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateNorm)) {
      return { ok: false, errorMessage: uiCopy.calendarValidation.invalidDateFormat };
    }

    // Application-level duplicate pre-check (best-effort; the DB UNIQUE index
    // uidx_user_calendar_events_manual_dedup is the authoritative race-free guard).
    const { data: existing, error: dupErr } = await supabase
      .from('user_calendar_events')
      .select('id')
      .eq('owner_id', event.owner_id)
      .eq('owner_type', event.owner_type)
      .eq('date', dateNorm)
      .eq('title', event.title)
      .limit(1)
      .maybeSingle();
    if (dupErr) {
      console.warn('insertManualEvent duplicate check error:', dupErr);
    } else if (existing?.id) {
      console.warn('insertManualEvent: duplicate event detected (pre-check)', dateNorm, event.title);
      return {
        ok: false,
        errorMessage: uiCopy.calendarValidation.duplicateEvent ?? 'An event with the same title already exists on this date.',
        isDuplicate: true,
      };
    }

    const { data, error } = await supabase
      .from('user_calendar_events')
      .insert({
        owner_id: event.owner_id,
        owner_type: event.owner_type,
        date: dateNorm,
        start_time: event.start_time ?? null,
        end_time: event.end_time ?? null,
        title: event.title,
        color: event.color ?? DEFAULT_COLORS[0],
        note: event.note ?? null,
        organization_id: event.organization_id ?? null,
        created_by: event.created_by ?? null,
        reminder_at: event.reminder_at ?? null,
        updated_at: new Date().toISOString(),
      })
      .select(
        'id, owner_id, owner_type, date, start_time, end_time, title, color, note, organization_id, created_by, reminder_at, created_at, updated_at'
      )
      .single();
    if (error) {
      // Postgres unique-violation code 23505 means the DB-level constraint caught a
      // concurrent duplicate that slipped past the pre-check above (TOCTOU closed).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((error as any).code === '23505') {
        console.warn('insertManualEvent: duplicate caught by DB unique constraint', dateNorm, event.title);
        return {
          ok: false,
          errorMessage: uiCopy.calendarValidation.duplicateEvent ?? 'An event with the same title already exists on this date.',
          isDuplicate: true,
        };
      }
      console.error('insertManualEvent error:', error);
      return { ok: false, errorMessage: error.message || uiCopy.calendarValidation.insertFailed };
    }
    return { ok: true, event: data as UserCalendarEvent };
  } catch (e) {
    console.error('insertManualEvent exception:', e);
    return { ok: false, errorMessage: e instanceof Error ? e.message : uiCopy.calendarValidation.insertFailed };
  }
}

export async function updateManualEvent(
  id: string,
  updates: Partial<Pick<UserCalendarEvent, 'date' | 'start_time' | 'end_time' | 'title' | 'color' | 'note' | 'reminder_at'>>
): Promise<boolean> {
  if (!isUuid(id)) {
    console.error('updateManualEvent: id must be a valid UUID');
    return false;
  }
  try {
    if (updates.date != null) {
      const d = String(updates.date).trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) {
        console.error('updateManualEvent: invalid date');
        return false;
      }
      updates = { ...updates, date: d };
    }
    const { error } = await supabase
      .from('user_calendar_events')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) {
      console.error('updateManualEvent error:', error);
      return false;
    }
    return true;
  } catch (e) {
    console.error('updateManualEvent exception:', e);
    return false;
  }
}

export async function deleteManualEvent(id: string): Promise<boolean> {
  if (!isUuid(id)) {
    console.error('deleteManualEvent: id must be a valid UUID');
    return false;
  }
  try {
    const { error } = await supabase.from('user_calendar_events').delete().eq('id', id);
    if (error) {
      console.error('deleteManualEvent error:', error);
      return false;
    }
    return true;
  } catch (e) {
    console.error('deleteManualEvent exception:', e);
    return false;
  }
}

export { DEFAULT_COLORS as MANUAL_EVENT_COLORS };
