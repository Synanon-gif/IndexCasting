/**
 * Time-axis helpers for week/day calendar views (layout only — no business rules).
 */

const TIME_RE = /^(\d{1,2}):(\d{2})/;

/** Parses "HH:MM" or "HH:MM:SS" to minutes from midnight; null if invalid. */
export function parseTimeToMinutes(t: string | null | undefined): number | null {
  if (t == null || typeof t !== 'string') return null;
  const m = t.trim().match(TIME_RE);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min) || h > 23 || min > 59) return null;
  return h * 60 + min;
}

export function formatMinutesAsHm(totalMin: number): string {
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function addDaysYmd(yyyyMmDd: string, delta: number): string {
  const [y, mo, d] = yyyyMmDd.split('-').map(Number);
  const dt = new Date(y, mo - 1, d + delta);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/** Monday-based week start (ISO weekday), local calendar date. */
export function startOfWeekMonday(yyyyMmDd: string): string {
  const [y, mo, d] = yyyyMmDd.split('-').map(Number);
  const dt = new Date(y, mo - 1, d);
  const dow = (dt.getDay() + 6) % 7;
  dt.setDate(dt.getDate() - dow);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

export function weekDayDates(weekStartMonday: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < 7; i++) out.push(addDaysYmd(weekStartMonday, i));
  return out;
}

export function todayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

export type Laneable = { startMin: number; endMin: number };

/**
 * Greedy lane assignment for overlapping events (same semantics as common calendar UIs).
 */
export function assignOverlapLanes<T extends Laneable>(
  events: T[],
): Array<T & { lane: number; laneCount: number }> {
  if (events.length === 0) return [];
  const sorted = [...events].sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
  const laneEnds: number[] = [];
  let maxLane = 0;
  const tagged = sorted.map((ev) => {
    let lane = 0;
    while (lane < laneEnds.length && laneEnds[lane] > ev.startMin) {
      lane += 1;
    }
    if (lane === laneEnds.length) laneEnds.push(ev.endMin);
    else laneEnds[lane] = ev.endMin;
    if (lane > maxLane) maxLane = lane;
    return { ...ev, lane, laneCount: 0 };
  });
  const laneCount = maxLane + 1;
  return tagged.map((r) => ({ ...r, laneCount }));
}

/** Default untimed business block (09:00–10:00) for rows without schedule. */
export const DEFAULT_BLOCK_START_MIN = 9 * 60;
export const DEFAULT_BLOCK_END_MIN = 10 * 60;
