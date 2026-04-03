/**
 * Centralized calendar color constants.
 * Consistent across AgencyControllerView, ClientWebApp, and any future calendar views.
 */

export const CALENDAR_COLORS = {
  casting:  '#1565C0',  // blue
  gosee:    '#0288D1',  // light blue
  option:   '#E65100',  // deep orange
  booking:  '#B71C1C',  // red
  personal: '#616161',  // grey
  job:      '#1B5E20',  // dark green
} as const;

export type CalendarEntryColorType = keyof typeof CALENDAR_COLORS;

/** Returns the color for a calendar entry type. Defaults to personal (grey). */
export function calendarEntryColor(entryType: string | undefined): string {
  if (!entryType) return CALENDAR_COLORS.personal;
  return CALENDAR_COLORS[entryType as CalendarEntryColorType] ?? CALENDAR_COLORS.personal;
}
