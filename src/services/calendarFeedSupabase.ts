/**
 * Private calendar feed token + ICS download (authenticated).
 */

import { supabase } from '../../lib/supabase';
import { supabaseUrl } from '../config/env';
import { buildIcsCalendar, icsEventsFromExportPayload } from '../utils/icsCalendar';

export type RotateFeedTokenResult = { ok: true; token: string } | { ok: false; reason: string };

export async function rotateCalendarFeedToken(): Promise<RotateFeedTokenResult> {
  try {
    const { data, error } = await supabase.rpc('rotate_calendar_feed_token');
    if (error) {
      console.error('[calendarFeed] rotate_calendar_feed_token error:', error);
      return { ok: false, reason: error.message ?? 'rotate_failed' };
    }
    const row = data as { token?: string } | null;
    const token = row?.token != null ? String(row.token) : '';
    if (!token) {
      return { ok: false, reason: 'no_token' };
    }
    return { ok: true, token };
  } catch (e) {
    console.error('[calendarFeed] rotateCalendarFeedToken exception:', e);
    return { ok: false, reason: 'exception' };
  }
}

export async function revokeCalendarFeedToken(): Promise<boolean> {
  try {
    const { error } = await supabase.rpc('revoke_calendar_feed_token');
    if (error) {
      console.error('[calendarFeed] revoke_calendar_feed_token error:', error);
      return false;
    }
    return true;
  } catch (e) {
    console.error('[calendarFeed] revokeCalendarFeedToken exception:', e);
    return false;
  }
}

/** HTTPS URL for subscription (Google "From URL"). */
export function calendarFeedSubscribeUrl(plaintextToken: string): string {
  const base = supabaseUrl.replace(/\/$/, '');
  return `${base}/functions/v1/calendar-feed?token=${encodeURIComponent(plaintextToken)}`;
}

/** webcal:// scheme for Apple Calendar. */
export function calendarFeedWebcalUrl(plaintextToken: string): string {
  return calendarFeedSubscribeUrl(plaintextToken).replace(/^https:\/\//i, 'webcal://');
}

export type DownloadIcsResult = { ok: true } | { ok: false; reason: string };

/**
 * Fetches the user's calendar JSON via RPC and triggers a .ics download (web only).
 */
export async function downloadCalendarIcsFile(): Promise<DownloadIcsResult> {
  try {
    const { data, error } = await supabase.rpc('get_calendar_export_payload_for_me');
    if (error) {
      console.error('[calendarFeed] get_calendar_export_payload_for_me error:', error);
      return { ok: false, reason: error.message ?? 'fetch_failed' };
    }
    const events = icsEventsFromExportPayload(data as unknown);
    const ics = buildIcsCalendar(events, { calName: 'IndexCasting' });

    if (typeof document !== 'undefined' && typeof Blob !== 'undefined') {
      const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `indexcasting-calendar-${new Date().toISOString().slice(0, 10)}.ics`;
      a.click();
      URL.revokeObjectURL(url);
    }
    return { ok: true };
  } catch (e) {
    console.error('[calendarFeed] downloadCalendarIcsFile exception:', e);
    return { ok: false, reason: 'exception' };
  }
}
