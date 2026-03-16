import { supabase } from '../../lib/supabase';

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
  created_at: string;
  updated_at: string;
};

const DEFAULT_COLORS = ['#1565C0', '#2E7D32', '#F9A825', '#C62828', '#6A1B9A', '#00838F'];

export async function getManualEventsForOwner(
  ownerId: string,
  ownerType: 'client' | 'agency'
): Promise<UserCalendarEvent[]> {
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

export async function insertManualEvent(event: {
  owner_id: string;
  owner_type: 'client' | 'agency';
  date: string;
  start_time?: string;
  end_time?: string;
  title: string;
  color?: string;
  note?: string;
}): Promise<UserCalendarEvent | null> {
  const { data, error } = await supabase
    .from('user_calendar_events')
    .insert({
      owner_id: event.owner_id,
      owner_type: event.owner_type,
      date: event.date,
      start_time: event.start_time ?? null,
      end_time: event.end_time ?? null,
      title: event.title,
      color: event.color ?? DEFAULT_COLORS[0],
      note: event.note ?? null,
      updated_at: new Date().toISOString(),
    })
    .select()
    .single();
  if (error) {
    console.error('insertManualEvent error:', error);
    return null;
  }
  return data as UserCalendarEvent;
}

export async function updateManualEvent(
  id: string,
  updates: Partial<Pick<UserCalendarEvent, 'date' | 'start_time' | 'end_time' | 'title' | 'color' | 'note'>>
): Promise<boolean> {
  const { error } = await supabase
    .from('user_calendar_events')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) {
    console.error('updateManualEvent error:', error);
    return false;
  }
  return true;
}

export async function deleteManualEvent(id: string): Promise<boolean> {
  const { error } = await supabase.from('user_calendar_events').delete().eq('id', id);
  if (error) {
    console.error('deleteManualEvent error:', error);
    return false;
  }
  return true;
}

export { DEFAULT_COLORS as MANUAL_EVENT_COLORS };
