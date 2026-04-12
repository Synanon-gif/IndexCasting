/**
 * Canonical calendar → option_requests thread navigation (option_requests.id === thread id).
 * Uses real IDs only — no name/title heuristics. See system-invariants: calendar deeplinks.
 */
import type { CalendarEntry } from '../services/calendarSupabase';

/** Same RFC-variant check as legacy ClientWebApp / AgencyControllerView calendar guards. */
export function isCalendarThreadUuid(value: string | null | undefined): boolean {
  if (!value || typeof value !== 'string') return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.trim());
}

/**
 * Prefer calendar_entries.option_request_id when present; fall back to option_requests.id.
 * If both are set and differ → unsafe (data inconsistency) → null (fail closed).
 */
export function resolveCanonicalOptionRequestIdForCalendarThread(
  optionId: string | null | undefined,
  calendarEntryOptionRequestId: string | null | undefined,
): string | null {
  const o = optionId?.trim() ?? '';
  const ce = calendarEntryOptionRequestId?.trim() ?? '';
  const oOk = o.length > 0 && isCalendarThreadUuid(o);
  const ceOk = ce.length > 0 && isCalendarThreadUuid(ce);
  if (ceOk && oOk && ce !== o) return null;
  if (ceOk) return ce;
  if (oOk) return o;
  return null;
}

export function resolveCanonicalOptionRequestIdForCalendarItem(item: {
  option: { id: string };
  calendar_entry: Pick<CalendarEntry, 'option_request_id'> | null;
}): string | null {
  return resolveCanonicalOptionRequestIdForCalendarThread(
    item.option.id,
    item.calendar_entry?.option_request_id ?? null,
  );
}

/** Booking-only calendar row (orphan booking_events / deduped row): thread id is option_request_id only. */
export function resolveCanonicalOptionRequestIdFromBookingCalendarEntry(
  entry: Pick<CalendarEntry, 'option_request_id'> | null | undefined,
): string | null {
  return resolveCanonicalOptionRequestIdForCalendarThread(null, entry?.option_request_id ?? null);
}
