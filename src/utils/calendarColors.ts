/**
 * Centralized calendar color constants.
 * Consistent across AgencyControllerView, ClientWebApp, and any future calendar views.
 */

import { colors } from '../theme/theme';

export const CALENDAR_COLORS = {
  casting: '#1565C0', // blue
  gosee: '#0288D1', // light blue
  option: '#E65100', // deep orange
  // `booking` and `job` MUST stay the same hex.
  // Product semantics: a `calendar_entries.entry_type='booking'` row is always
  // a confirmed Job (DB triggers set the title to 'Job – …'). The user-facing
  // colour legend exposes a single "Job" swatch (green) — there is no separate
  // "Booking" pill. If you want to give a tentative booking a different colour,
  // do it via the `status='tentative' → CALENDAR_COLORS.option` override
  // (see `agencyCalendarUnified.ts` and `calendarProjectionLabel.ts`), not by
  // making this base mapping diverge from `job`.
  booking: '#1B5E20', // dark green — kept identical to .job by invariant
  personal: '#616161', // grey
  job: '#1B5E20', // dark green
} as const;

/**
 * Month dots / badges for B2B option-thread attention (see `calendarProjectionLabel`).
 * Keep in sync with `CalendarColorLegend` extended rows.
 */
export const CALENDAR_PROJECTION_COLORS = {
  awaitingModel: '#7B1FA2',
  jobConfirmationPending: '#5D4037',
  /** Rejected or inactive rows — matches theme `textSecondary`. */
  rejected: colors.textSecondary,
} as const;

export type CalendarEntryColorType = keyof typeof CALENDAR_COLORS;

/**
 * Maps a **raw** `calendar_entries.entry_type` string to a theme swatch. Does **not** apply
 * lifecycle/title rules (Job confirmed vs Option, tentative booking, etc.).
 *
 * - **Do not** use for B2B unified calendar or model profile **event blocks** / month dots — use
 *   `getCalendarEntryBlockColor` / projection helpers in `calendarProjectionLabel.ts` (Job titles,
 *   tentative override, legend parity).
 * - Safe uses: unit tests, trivial type→hex tables, or non-calendar UI that only has `entry_type`.
 * - **Policy:** app code under `src/` must not *import* this symbol; CI is guarded by
 *   `src/utils/__tests__/calendarColorImportPolicy.test.ts` (intentional changes: adjust that test
 *   and `.cursor/rules/calendar-colors-single-source.mdc` together).
 */
export function calendarEntryColor(entryType: string | undefined): string {
  if (!entryType) return CALENDAR_COLORS.personal;
  return CALENDAR_COLORS[entryType as CalendarEntryColorType] ?? CALENDAR_COLORS.personal;
}

/**
 * Option-request thread list status pills (Messages tab).
 * Not the same semantic as `calendarEntryColor` (calendar `entry_type`).
 * Shared by ClientWebApp and AgencyControllerView for consistent badges.
 */
export type OptionRequestChatStatus = 'in_negotiation' | 'confirmed' | 'rejected';

export const OPTION_REQUEST_CHAT_STATUS_COLORS: Record<OptionRequestChatStatus, string> = {
  in_negotiation: '#B8860B',
  confirmed: colors.buttonOptionGreen,
  rejected: colors.textSecondary,
};
