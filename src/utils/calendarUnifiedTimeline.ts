/**
 * Timeline segments for B2B week & day — **same semantic hex** as month chips from
 * `buildEventsByDateFromUnifiedRows` for the same `UnifiedAgencyCalendarRow[]`. Uses the locked
 * hierarchy in `calendarProjectionLabel.ts` (projection → entry-only → manual); no duplicate color
 * rules. This module maps times + color only — it does not change row selection, navigation, or payloads.
 */
import type { UnifiedAgencyCalendarRow } from './agencyCalendarUnified';
import type {
  CalendarProjectionLabels,
  CalendarProjectionViewerRole,
} from './calendarProjectionLabel';
import {
  getBookingEntryProjectionBadge,
  getCalendarProjectionBadge,
  resolveUserCalendarEventBlockColor,
} from './calendarProjectionLabel';
import {
  DEFAULT_BLOCK_END_MIN,
  DEFAULT_BLOCK_START_MIN,
  parseTimeToMinutes,
} from './calendarTimelineLayout';

/** Minimal block for week/day views (no business payload). */
export type CalendarScheduleBlock = {
  id: string;
  date: string;
  startMin: number;
  endMin: number;
  title: string;
  color: string;
};

export type CalendarTimelineEvent = CalendarScheduleBlock & {
  unifiedRowId: string;
  row: UnifiedAgencyCalendarRow;
};

function resolveOptionTimes(row: UnifiedAgencyCalendarRow & { kind: 'option' }): {
  startMin: number;
  endMin: number;
} {
  const { item } = row;
  const ce = item.calendar_entry;
  const opt = item.option;
  const start =
    parseTimeToMinutes(ce?.start_time ?? null) ??
    parseTimeToMinutes(opt.start_time ?? null) ??
    DEFAULT_BLOCK_START_MIN;
  let end =
    parseTimeToMinutes(ce?.end_time ?? null) ??
    parseTimeToMinutes(opt.end_time ?? null) ??
    start + (DEFAULT_BLOCK_END_MIN - DEFAULT_BLOCK_START_MIN);
  if (end <= start) end = start + 30;
  return { startMin: start, endMin: end };
}

function resolveBookingTimes(row: UnifiedAgencyCalendarRow & { kind: 'booking' }): {
  startMin: number;
  endMin: number;
} {
  const e = row.entry;
  const start = parseTimeToMinutes(e.start_time ?? null) ?? DEFAULT_BLOCK_START_MIN;
  let end = parseTimeToMinutes(e.end_time ?? null) ?? start + 60;
  if (end <= start) end = start + 30;
  return { startMin: start, endMin: end };
}

function resolveManualTimes(row: UnifiedAgencyCalendarRow & { kind: 'manual' }): {
  startMin: number;
  endMin: number;
} {
  const ev = row.ev;
  const start = parseTimeToMinutes(ev.start_time ?? null) ?? DEFAULT_BLOCK_START_MIN;
  let end = parseTimeToMinutes(ev.end_time ?? null) ?? start + 60;
  if (end <= start) end = start + 30;
  return { startMin: start, endMin: end };
}

/**
 * B2B week/day `block.color`: same resolver chain as `buildEventsByDateFromUnifiedRows` / month grid
 * for each `UnifiedAgencyCalendarRow` id — keeps month / week / day semantically aligned.
 */
export function buildTimelineEventsFromUnifiedRows(
  rows: UnifiedAgencyCalendarRow[],
  viewerRole: CalendarProjectionViewerRole,
  labels: CalendarProjectionLabels,
): CalendarTimelineEvent[] {
  const out: CalendarTimelineEvent[] = [];
  for (const row of rows) {
    if (!row.date) continue;
    if (row.kind === 'manual') {
      const { startMin, endMin } = resolveManualTimes(row);
      out.push({
        id: row.id,
        unifiedRowId: row.id,
        date: row.date,
        startMin,
        endMin,
        title: row.title,
        color: resolveUserCalendarEventBlockColor(row.ev),
        row,
      });
      continue;
    }
    if (row.kind === 'booking') {
      const badge = getBookingEntryProjectionBadge(row.entry, labels);
      const { startMin, endMin } = resolveBookingTimes(row);
      out.push({
        id: row.id,
        unifiedRowId: row.id,
        date: row.date,
        startMin,
        endMin,
        title: row.title,
        color: badge.backgroundColor,
        row,
      });
      continue;
    }
    const badge = getCalendarProjectionBadge(
      row.item.option,
      row.item.calendar_entry,
      labels,
      viewerRole,
    );
    const { startMin, endMin } = resolveOptionTimes(row);
    out.push({
      id: row.id,
      unifiedRowId: row.id,
      date: row.date,
      startMin,
      endMin,
      title: row.title,
      color: badge.backgroundColor,
      row,
    });
  }
  return out;
}

export function filterTimelineEventsForDate(
  events: CalendarTimelineEvent[],
  date: string,
): CalendarTimelineEvent[] {
  return events.filter((e) => e.date === date);
}

export function filterTimelineEventsForWeek(
  events: CalendarTimelineEvent[],
  weekDates: string[],
): CalendarTimelineEvent[] {
  const set = new Set(weekDates);
  return events.filter((e) => set.has(e.date));
}
