/**
 * Centralized calendar color constants.
 * Consistent across AgencyControllerView, ClientWebApp, and any future calendar views.
 */

import { colors } from '../theme/theme';

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
