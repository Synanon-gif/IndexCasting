/**
 * Model calendar — **one** hierarchy for active `calendar_entries` surfaces (month grid, week, day).
 * No new fetches, no store rewrites, no duplicated projection rules.
 *
 * 1. **Projection (wins when equivalent context exists):** `option_request_id` + `getOptionForProjection`
 *    returns `OptionRequest` → `calendarGridColorForOptionItem` (same HEX as B2B for the same option+entry).
 * 2. **Entry-only fallback:** no cached option → `getCalendarEntryBlockColor` (orphan / title–job
 *    heuristics; same as B2B standalone rows). B2B vs model color mismatch is **not** a resolver bug
 *    when the model truly lacks cached projection context (Rule C in product docs).
 * 3. **B2B-only:** manual `user_calendar_events` use `resolveUserCalendarEventBlockColor` elsewhere.
 */
import type { CalendarEntry, CalendarEntryType } from '../services/calendarSupabase';
import type { CalendarDayEvent } from '../components/MonthCalendarView';
import type { OptionRequest } from '../store/optionRequests';
import type { CalendarScheduleBlock } from './calendarUnifiedTimeline';
import {
  calendarGridColorForOptionItem,
  getCalendarEntryBlockColor,
} from './calendarProjectionLabel';
import { toSupabaseOptionForCalendarProjectionFromStore } from './optionRequestStoreProjectionAdapter';
import {
  DEFAULT_BLOCK_END_MIN,
  DEFAULT_BLOCK_START_MIN,
  parseTimeToMinutes,
} from './calendarTimelineLayout';
import { logCalendarPreDedupeIfDuplicatesDev } from './invariantValidationDev';

/**
 * Model-side **single entry point** for block/dot hex. Projection first; entry-only fallback never
 * invents random colors. Active surfaces must call this (or `buildEventsByDateFromModelEntries`) —
 * do not duplicate `resolveProjectionBucket` in UI.
 */
export function resolveModelCalendarEntryColor(
  entry: CalendarEntry,
  getOptionForProjection?: (optionRequestId: string) => OptionRequest | undefined,
): string {
  const oid = entry.option_request_id;
  if (oid && getOptionForProjection) {
    const o = getOptionForProjection(oid);
    if (o) {
      return calendarGridColorForOptionItem({
        option: toSupabaseOptionForCalendarProjectionFromStore(o),
        calendar_entry: entry,
      });
    }
  }
  return getCalendarEntryBlockColor(entry);
}

export function buildEventsByDateFromModelEntries(
  entries: CalendarEntry[],
  getOptionForProjection?: (optionRequestId: string) => OptionRequest | undefined,
): Record<string, CalendarDayEvent[]> {
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
      if (!seenSet) {
        seenSet = new Set();
        seenOptionPerDate.set(d, seenSet);
      }
      if (seenSet.has(e.option_request_id)) continue;
      seenSet.add(e.option_request_id);
    }

    if (!map[d]) map[d] = [];
    map[d].push({
      id: e.id,
      color: resolveModelCalendarEntryColor(e, getOptionForProjection),
      title: (e.title ?? e.entry_type ?? 'Event').trim() || 'Event',
      kind: e.entry_type ?? undefined,
    });
  }
  return map;
}

function blockFromEntry(
  e: CalendarEntry,
  getOptionForProjection?: (optionRequestId: string) => OptionRequest | undefined,
): CalendarScheduleBlock {
  const date = e.date ?? '';
  const start = parseTimeToMinutes(e.start_time ?? null) ?? DEFAULT_BLOCK_START_MIN;
  let end =
    parseTimeToMinutes(e.end_time ?? null) ??
    start + (DEFAULT_BLOCK_END_MIN - DEFAULT_BLOCK_START_MIN);
  if (end <= start) end = start + 30;
  return {
    id: e.id,
    date,
    startMin: start,
    endMin: end,
    title: (e.title ?? e.entry_type ?? 'Event').trim() || 'Event',
    color: resolveModelCalendarEntryColor(e, getOptionForProjection),
  };
}

function lifecycleRank(t: CalendarEntryType): number {
  if (t === 'booking') return 3;
  if (t === 'option') return 2;
  if (t === 'casting' || t === 'gosee') return 2;
  return 1;
}

/** True if `a` should replace `b` as the canonical row for the same option_request_id. */
function modelCalendarEntryBeats(a: CalendarEntry, b: CalendarEntry): boolean {
  const ac = a.status === 'cancelled';
  const bc = b.status === 'cancelled';
  if (ac && !bc) return false;
  if (!ac && bc) return true;
  const ra = lifecycleRank(a.entry_type);
  const rb = lifecycleRank(b.entry_type);
  if (ra > rb) return true;
  if (ra < rb) return false;
  const ta = a.created_at ?? '';
  const tb = b.created_at ?? '';
  return ta > tb;
}

/**
 * Per-lifecycle dedup for model calendar entries: when multiple calendar_entries
 * share the same option_request_id (e.g. lifecycle transitions), keep one winner:
 * non-cancelled over cancelled, job/booking over option/casting, then newest created_at.
 */
export function dedupeModelCalendarEntries(entries: CalendarEntry[]): CalendarEntry[] {
  logCalendarPreDedupeIfDuplicatesDev(entries, 'dedupeModelCalendarEntries');
  const byOptionId = new Map<string, CalendarEntry>();
  const result: CalendarEntry[] = [];

  for (const e of entries) {
    if (!e.option_request_id) {
      result.push(e);
      continue;
    }
    const existing = byOptionId.get(e.option_request_id);
    if (!existing) {
      byOptionId.set(e.option_request_id, e);
      continue;
    }
    if (modelCalendarEntryBeats(e, existing)) {
      byOptionId.set(e.option_request_id, e);
    }
  }
  result.push(...byOptionId.values());
  return result;
}

export function filterModelScheduleBlocksForDate(
  entries: CalendarEntry[],
  date: string,
  getOptionForProjection?: (optionRequestId: string) => OptionRequest | undefined,
): CalendarScheduleBlock[] {
  return dedupeModelCalendarEntries(entries)
    .filter((e) => e.date === date)
    .map((e) => blockFromEntry(e, getOptionForProjection))
    .sort((a, b) => a.startMin - b.startMin || a.title.localeCompare(b.title));
}

export function filterModelScheduleBlocksForWeek(
  entries: CalendarEntry[],
  weekDates: string[],
  getOptionForProjection?: (optionRequestId: string) => OptionRequest | undefined,
): CalendarScheduleBlock[] {
  const set = new Set(weekDates);
  return dedupeModelCalendarEntries(entries)
    .filter((e) => e.date && set.has(e.date))
    .map((e) => blockFromEntry(e, getOptionForProjection))
    .sort((a, b) => a.date.localeCompare(b.date) || a.startMin - b.startMin);
}
