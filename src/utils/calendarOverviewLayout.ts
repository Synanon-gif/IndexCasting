/**
 * Pure helpers for B2B calendar overview density (month/week/day UI only).
 */
import { CALENDAR_COLORS } from './calendarColors';
import type { CalendarScheduleBlock, CalendarTimelineEvent } from './calendarUnifiedTimeline';
import { formatMinutesAsHm } from './calendarTimelineLayout';

export type OverviewKindBucket = 'job' | 'casting' | 'option' | 'manual' | 'other';

/** Subset of month-cell events — compatible with `CalendarDayEvent`. */
export type MonthOverviewEvent = { id: string; title: string; kind?: string };

/** Maps raw `kind` strings from `buildEventsByDateFromUnifiedRows` to coarse buckets. */
export function monthEventKindBucket(kind?: string): OverviewKindBucket {
  const k = (kind ?? '').toLowerCase();
  if (k === 'manual') return 'manual';
  if (k === 'job' || k.includes('job')) return 'job';
  if (k === 'casting' || k.includes('cast')) return 'casting';
  if (k === 'option' || k === 'booking' || k.includes('option')) return 'option';
  return 'other';
}

/** Display order: higher first (tie-break: title). */
const BUCKET_PRIORITY: Record<OverviewKindBucket, number> = {
  job: 4,
  casting: 3,
  option: 2,
  manual: 1,
  other: 0,
};

export function sortCalendarDayEventsForOverview<T extends MonthOverviewEvent>(events: T[]): T[] {
  return [...events].sort((a, b) => {
    const pa = BUCKET_PRIORITY[monthEventKindBucket(a.kind)];
    const pb = BUCKET_PRIORITY[monthEventKindBucket(b.kind)];
    if (pb !== pa) return pb - pa;
    return a.title.localeCompare(b.title);
  });
}

export type KindCountSegment = { bucket: OverviewKindBucket; count: number; color: string };

/** Ordered segments for a horizontal density strip (omit zero counts). */
export function monthDayKindSegments(events: MonthOverviewEvent[]): KindCountSegment[] {
  const counts: Record<OverviewKindBucket, number> = {
    job: 0,
    casting: 0,
    option: 0,
    manual: 0,
    other: 0,
  };
  for (const e of events) {
    counts[monthEventKindBucket(e.kind)] += 1;
  }
  const order: OverviewKindBucket[] = ['job', 'casting', 'option', 'manual', 'other'];
  const colors: Record<OverviewKindBucket, string> = {
    job: CALENDAR_COLORS.job,
    casting: CALENDAR_COLORS.casting,
    option: CALENDAR_COLORS.option,
    manual: CALENDAR_COLORS.personal,
    other: CALENDAR_COLORS.option,
  };
  const out: KindCountSegment[] = [];
  for (const b of order) {
    const n = counts[b];
    if (n > 0) out.push({ bucket: b, count: n, color: colors[b] });
  }
  return out;
}

export function weekBlockKindBucket(ev: CalendarScheduleBlock): OverviewKindBucket {
  const te = ev as CalendarTimelineEvent;
  const row = te?.row;
  if (!row) return 'other';
  if (row.kind === 'manual') return 'manual';
  if (row.kind === 'booking') {
    const t = (row.entry.entry_type ?? '').toLowerCase();
    if (t === 'job' || t.includes('job')) return 'job';
    if (t === 'casting' || t.includes('cast')) return 'casting';
    return 'option';
  }
  const et = (row.item.calendar_entry?.entry_type ?? '').toLowerCase();
  if (et === 'job' || et.includes('job')) return 'job';
  if (et === 'casting' || et.includes('cast')) return 'casting';
  return 'option';
}

export function weekColumnKindSegments(blocks: CalendarScheduleBlock[]): KindCountSegment[] {
  const counts: Record<OverviewKindBucket, number> = {
    job: 0,
    casting: 0,
    option: 0,
    manual: 0,
    other: 0,
  };
  for (const b of blocks) {
    counts[weekBlockKindBucket(b)] += 1;
  }
  const order: OverviewKindBucket[] = ['job', 'casting', 'option', 'manual', 'other'];
  const colors: Record<OverviewKindBucket, string> = {
    job: CALENDAR_COLORS.job,
    casting: CALENDAR_COLORS.casting,
    option: CALENDAR_COLORS.option,
    manual: CALENDAR_COLORS.personal,
    other: CALENDAR_COLORS.option,
  };
  const out: KindCountSegment[] = [];
  for (const b of order) {
    const n = counts[b];
    if (n > 0) out.push({ bucket: b, count: n, color: colors[b] });
  }
  return out;
}

const BUCKET_LETTER: Record<OverviewKindBucket, string> = {
  job: 'J',
  casting: 'C',
  option: 'O',
  manual: 'P',
  other: '·',
};

export function formatWeekKindFooterShort(segments: KindCountSegment[]): string {
  return segments.map((s) => `${BUCKET_LETTER[s.bucket]}${s.count}`).join(' ');
}

/** Visual height cap for long blocks; duration used for label only. */
export function cappedBlockLayout(
  startMin: number,
  endMin: number,
  pxPerMin: number,
  minHeightPx: number,
  maxHeightPx: number | undefined,
  capFromDurationMin: number | undefined,
): { heightPx: number; isCapped: boolean; durationMin: number } {
  const durationMin = Math.max(0, endMin - startMin);
  const natural = Math.max(durationMin * pxPerMin, minHeightPx);
  if (maxHeightPx == null || capFromDurationMin == null || durationMin <= capFromDurationMin) {
    return { heightPx: natural, isCapped: false, durationMin };
  }
  return { heightPx: Math.max(minHeightPx, maxHeightPx), isCapped: true, durationMin };
}

export function blockTimeRangeLabel(startMin: number, endMin: number, isCapped: boolean): string {
  const a = formatMinutesAsHm(startMin);
  const b = formatMinutesAsHm(endMin);
  if (isCapped) return `${a}–${b}`;
  return a;
}
