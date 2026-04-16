/**
 * Canonical calendar export / dedupe priorities (lower number = wins in ROW_NUMBER / ICS merge).
 * MUST stay in sync with `public.calendar_export_events_json` (migration
 * `20260901_calendar_export_events_json_include_booking_events.sql` + COMMENT)
 * and with `icsEventsFromExportPayload` tie-breaking.
 */
export const BOOKING_EVENT = 0;
export const CALENDAR_ENTRY_BOOKING = 1;
export const CALENDAR_ENTRY_OPTION = 2;
export const USER_CALENDAR_EVENT_MIRROR = 3;
export const USER_CALENDAR_EVENT_MANUAL = 4;
