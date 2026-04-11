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
  // Track which option_request_ids we have already added per date so that multiple
  // calendar_entries rows for the same option (e.g. after a lifecycle transition) don't
  // produce multiple dots on the same day — matches the B2B month grid dedup invariant.
  const seenOptionPerDate = new Map<string, Set<string>>();

  for (const e of entries) {
    const d = e.date;
    if (!d) continue;

    if (e.option_request_id) {
      let seenSet = seenOptionPerDate.get(d);
      if (!seenSet) { seenSet = new Set(); seenOptionPerDate.set(d, seenSet); }
      if (seenSet.has(e.option_request_id)) continue;
      seenSet.add(e.option_request_id);
    }

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
