-- Documents calendar_export_events_json sourcePriority mapping for audit parity with the app.
-- Numeric literals in the function body MUST match src/constants/calendarSourcePriority.ts:
--   BOOKING_EVENT = 0                 (reserved when booking_events table is unioned into export)
--   CALENDAR_ENTRY_BOOKING = 1
--   CALENDAR_ENTRY_OPTION = 2
--   USER_CALENDAR_EVENT_MIRROR = 3
--   USER_CALENDAR_EVENT_MANUAL = 4

COMMENT ON FUNCTION public.calendar_export_events_json(UUID) IS
  'Internal: merged user_calendar_events + calendar_entries for ICS/export. Dedupes by optionRequestId; '
  'lower sourcePriority wins. '
  'sourcePriority MUST match src/constants/calendarSourcePriority.ts: '
  'BOOKING_EVENT=0 (reserved), CALENDAR_ENTRY_BOOKING=1, CALENDAR_ENTRY_OPTION=2, '
  'USER_CALENDAR_EVENT_MIRROR=3, USER_CALENDAR_EVENT_MANUAL=4. '
  'Not exposed via PostgREST.';
