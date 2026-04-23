/**
 * Pure helpers for B2B calendar overview density (month/week/day UI only).
 */
import { uiCopy } from '../constants/uiCopy';
import { CALENDAR_COLORS, CALENDAR_PROJECTION_COLORS } from './calendarColors';
import {
  coarseOverviewKindForOptionItem,
  coarseOverviewKindFromProjectionColor,
  getCalendarEntryBlockColor,
} from './calendarProjectionLabel';
import type { CalendarScheduleBlock, CalendarTimelineEvent } from './calendarUnifiedTimeline';
import { formatMinutesAsHm } from './calendarTimelineLayout';

export type OverviewKindBucket = 'job' | 'casting' | 'option' | 'manual' | 'other';

/**
 * Subset of month-cell events — compatible with `CalendarDayEvent`.
 * `color` is the rendered block/dot hex (single source: projection or entry-only fallback) and must
 * match chips; the dense month strip aggregates by this value, not by lossy `kind` buckets.
 */
export type MonthOverviewEvent = { id: string; title: string; kind?: string; color: string };

/** Maps raw `kind` strings from `buildEventsByDateFromUnifiedRows` to coarse buckets. */
export function monthEventKindBucket(kind?: string): OverviewKindBucket {
  const k = (kind ?? '').toLowerCase();
  if (k === 'manual') return 'manual';
  if (k === 'other') return 'other';
  if (k === 'job' || k.includes('job')) return 'job';
  if (k === 'casting' || k.includes('cast')) return 'casting';
  /** B2B: `calendar_entries.entry_type='booking'` is a Job row, not the Option (orange) lane. */
  if (k === 'booking') return 'job';
  if (k === 'option' || k.includes('option')) return 'option';
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

export function weekBlockKindBucket(ev: CalendarScheduleBlock): OverviewKindBucket {
  const te = ev as CalendarTimelineEvent;
  const row = te?.row;
  if (!row) return 'other';
  if (row.kind === 'manual') return 'manual';
  if (row.kind === 'booking') {
    const c = getCalendarEntryBlockColor(row.entry);
    return coarseOverviewKindFromProjectionColor(c) as OverviewKindBucket;
  }
  return coarseOverviewKindForOptionItem({
    option: row.item.option,
    calendar_entry: row.item.calendar_entry,
  }) as OverviewKindBucket;
}

/**
 * Week column footer: counts by **rendered block color** (same hex as chips), not coarse buckets
 * that collapsed purple/brown into “other + grey”.
 */
export function weekColumnKindSegments(blocks: CalendarScheduleBlock[]): KindCountSegment[] {
  if (blocks.length === 0) return [];
  const byHex = new Map<string, number>();
  for (const b of blocks) {
    const c = b.color;
    byHex.set(c, (byHex.get(c) ?? 0) + 1);
  }
  const priority: string[] = [
    CALENDAR_COLORS.job,
    CALENDAR_COLORS.casting,
    CALENDAR_COLORS.option,
    CALENDAR_PROJECTION_COLORS.awaitingModel,
    CALENDAR_PROJECTION_COLORS.jobConfirmationPending,
    CALENDAR_COLORS.personal,
    CALENDAR_PROJECTION_COLORS.rejected,
  ];
  const out: KindCountSegment[] = [];
  const placed = new Set<string>();
  for (const h of priority) {
    const n = byHex.get(h);
    if (n) {
      out.push({ bucket: weekHexToFooterBucket(h), count: n, color: h });
      placed.add(h);
    }
  }
  for (const [h, n] of byHex.entries()) {
    if (!placed.has(h) && n > 0) {
      out.push({ bucket: 'other', count: n, color: h });
    }
  }
  return out;
}

/**
 * B2B month `denseOverview` horizontal strip: count by the same **semantic hex** as chips
 * (`event.color`), using the same ordering/priority as {@link weekColumnKindSegments}.
 * Do not aggregate via coarse `kind` (which maps projection “other” to reject grey).
 */
export function monthDayKindSegments(events: MonthOverviewEvent[]): KindCountSegment[] {
  if (events.length === 0) return [];
  return weekColumnKindSegments(
    events.map((e) => ({
      id: e.id,
      date: '',
      startMin: 0,
      endMin: 0,
      title: e.title,
      color: e.color,
    })),
  );
}

function weekHexToFooterBucket(h: string): OverviewKindBucket {
  if (h === CALENDAR_COLORS.job) return 'job';
  if (h === CALENDAR_COLORS.casting) return 'casting';
  if (h === CALENDAR_COLORS.option) return 'option';
  if (h === CALENDAR_COLORS.personal) return 'manual';
  return 'other';
}

/** Human-readable line under week columns — must match the dot `color` (legend semantics). */
export function weekKindSegmentLabel(seg: KindCountSegment): string {
  const c = seg.color;
  if (c === CALENDAR_COLORS.job) return uiCopy.calendar.overviewKindJob;
  if (c === CALENDAR_COLORS.casting) return uiCopy.calendar.overviewKindCasting;
  if (c === CALENDAR_COLORS.option) return uiCopy.calendar.overviewKindOption;
  if (c === CALENDAR_COLORS.personal) return uiCopy.calendar.overviewKindPersonal;
  if (c === CALENDAR_PROJECTION_COLORS.awaitingModel) return uiCopy.calendar.legendAwaitingModel;
  if (c === CALENDAR_PROJECTION_COLORS.jobConfirmationPending) {
    return uiCopy.calendar.legendJobConfirmationPending;
  }
  if (c === CALENDAR_PROJECTION_COLORS.rejected) return uiCopy.calendar.legendRejectedOrInactive;
  return uiCopy.calendar.overviewKindOther;
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

/** Time-of-day band for week chip grouping (visual only). */
export type DayTimeBand = 'early' | 'morning' | 'afternoon' | 'evening';

export function startMinToDayTimeBand(startMin: number): DayTimeBand {
  if (startMin < 6 * 60) return 'early';
  if (startMin < 12 * 60) return 'morning';
  if (startMin < 18 * 60) return 'afternoon';
  return 'evening';
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
