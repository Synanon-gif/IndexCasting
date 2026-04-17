/**
 * Canonical detail-first dispatch for calendar event taps/clicks.
 *
 * Regression context (restored 2026-04-17):
 * - Tapping a calendar event must open the EVENT DETAIL OVERLAY first
 *   (metadata, Open Negotiation button, BookingBriefEditor, shared/private notes).
 * - Direct chat navigation is only the explicit "Open Negotiation" CTA inside
 *   the detail overlay — never the default click action.
 *
 * `preferJobBookingOverOptionRows` (see agencyCalendarUnified.ts) replaces an
 * `option`-kind row with a `booking`-kind row for the same option_request_id when
 * a Job booking exists. The naive dispatch ("booking → onOpenBookingEntry → chat")
 * therefore bypassed the detail overlay for Job/Casting events that originated
 * from an Option. This helper restores the detail-first contract by routing those
 * booking rows back to the existing detail overlay via the option-id lookup.
 *
 * Pure, role-agnostic, no React/UI deps → safe to share between
 * AgencyControllerView and ClientWebApp dispatchers, and trivially testable.
 */
import type { UnifiedAgencyCalendarRow } from './agencyCalendarUnified';
import type { AgencyCalendarItem, CalendarEntry } from '../services/calendarSupabase';
import type { UserCalendarEvent } from '../services/userCalendarEventsSupabase';

export type CalendarRowOpenAction =
  | { type: 'openDetails'; item: AgencyCalendarItem }
  | { type: 'openManualEvent'; ev: UserCalendarEvent }
  | { type: 'openBookingEntry'; entry: CalendarEntry };

/**
 * Resolve the canonical open action for a unified calendar row.
 *
 * Rules:
 *  - `manual` → openManualEvent (manual user calendar events have their own dialog).
 *  - `option` → openDetails(item) — direct detail overlay.
 *  - `booking` with option_request_id resolvable in `itemByOptionId`
 *      → openDetails(item) — restored detail-first flow for Job rows that
 *        replaced an option tile via preferJobBookingOverOptionRows.
 *  - `booking` without resolvable item → openBookingEntry(entry)
 *        as a defensive fallback for orphan booking rows.
 */
export function resolveCalendarRowOpenAction(
  row: UnifiedAgencyCalendarRow,
  itemByOptionId: ReadonlyMap<string, AgencyCalendarItem>,
): CalendarRowOpenAction {
  if (row.kind === 'manual') {
    return { type: 'openManualEvent', ev: row.ev };
  }
  if (row.kind === 'option') {
    return { type: 'openDetails', item: row.item };
  }
  // row.kind === 'booking'
  const oid = row.entry.option_request_id ?? null;
  if (oid) {
    const item = itemByOptionId.get(oid);
    if (item) {
      return { type: 'openDetails', item };
    }
  }
  return { type: 'openBookingEntry', entry: row.entry };
}
