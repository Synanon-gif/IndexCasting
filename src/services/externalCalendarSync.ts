/**
 * Optional sync of confirmed bookings to Mediaslide / Netwalk (and other agency APIs).
 * GDPR: only transmit data covered by agency–model agreements and documented purposes.
 * Implement HTTP calls with agency-stored credentials when ready.
 */

import type { CalendarEntry } from './calendarSupabase';

export type ExternalSyncResult = { mediaslide: 'skipped' | 'ok' | 'error'; netwalk: 'skipped' | 'ok' | 'error' };

export async function syncConfirmedBookingToExternalCalendars(
  _entry: CalendarEntry,
  _context: { agencyId: string; modelMediaslideId?: string | null; modelNetwalkId?: string | null }
): Promise<ExternalSyncResult> {
  // TODO: call mediaslideConnector.pushAvailabilityToMediaslide / Netwalk equivalents
  console.info('[externalCalendarSync] Mediaslide/Netwalk sync not configured — entry kept in Supabase only.');
  return { mediaslide: 'skipped', netwalk: 'skipped' };
}
