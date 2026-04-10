/**
 * Model calendar: schedule blocks + month dots from `calendar_entries` only
 * (same colors as CALENDAR_COLORS / calendarEntryColor).
 */
import type { CalendarEntry } from '../services/calendarSupabase';
import type { CalendarDayEvent } from '../components/MonthCalendarView';
import type { CalendarScheduleBlock } from './calendarUnifiedTimeline';
import { calendarEntryColor } from './calendarColors';
import {
  DEFAULT_BLOCK_END_MIN,
  DEFAULT_BLOCK_START_MIN,
  parseTimeToMinutes,
} from './calendarTimelineLayout';

export function buildEventsByDateFromModelEntries(entries: CalendarEntry[]): Record<string, CalendarDayEvent[]> {
  const map: Record<string, CalendarDayEvent[]> = {};
  for (const e of entries) {
    const d = e.date;
    if (!d) continue;
    if (!map[d]) map[d] = [];
    map[d].push({
      id: e.id,
      color: calendarEntryColor(e.entry_type),
      title: (e.title ?? e.entry_type ?? 'Event').trim() || 'Event',
      kind: e.entry_type ?? undefined,
    });
  }
  return map;
}

function blockFromEntry(e: CalendarEntry): CalendarScheduleBlock {
  const date = e.date ?? '';
  const start =
    parseTimeToMinutes(e.start_time ?? null) ?? DEFAULT_BLOCK_START_MIN;
  let end = parseTimeToMinutes(e.end_time ?? null) ?? start + (DEFAULT_BLOCK_END_MIN - DEFAULT_BLOCK_START_MIN);
  if (end <= start) end = start + 30;
  return {
    id: e.id,
    date,
    startMin: start,
    endMin: end,
    title: (e.title ?? e.entry_type ?? 'Event').trim() || 'Event',
    color: calendarEntryColor(e.entry_type),
  };
}

export function filterModelScheduleBlocksForDate(entries: CalendarEntry[], date: string): CalendarScheduleBlock[] {
  return entries
    .filter((e) => e.date === date)
    .map(blockFromEntry)
    .sort((a, b) => a.startMin - b.startMin || a.title.localeCompare(b.title));
}

export function filterModelScheduleBlocksForWeek(entries: CalendarEntry[], weekDates: string[]): CalendarScheduleBlock[] {
  const set = new Set(weekDates);
  return entries
    .filter((e) => e.date && set.has(e.date))
    .map(blockFromEntry)
    .sort((a, b) => a.date.localeCompare(b.date) || a.startMin - b.startMin);
}
