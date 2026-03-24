import { supabase } from '../../lib/supabase';
import { uiCopy } from '../constants/uiCopy';

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
    .select('*')
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

export type InsertManualEventResult =
  | { ok: true; event: UserCalendarEvent }
  | { ok: false; errorMessage: string };

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
        updated_at: new Date().toISOString(),
      })
      .select(
        'id, owner_id, owner_type, date, start_time, end_time, title, color, note, organization_id, created_by, created_at, updated_at'
      )
      .single();
    if (error) {
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
  updates: Partial<Pick<UserCalendarEvent, 'date' | 'start_time' | 'end_time' | 'title' | 'color' | 'note'>>
): Promise<boolean> {
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
