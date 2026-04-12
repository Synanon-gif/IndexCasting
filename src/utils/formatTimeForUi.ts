/**
 * Presentation-only time formatting for option/thread/calendar labels.
 * Strips seconds from display; does not mutate stored backend values.
 */

export function stripClockSeconds(raw: string | null | undefined): string {
  if (raw == null) return '';
  const s = String(raw).trim();
  if (!s) return '';
  const tIdx = s.indexOf('T');
  const timePart = tIdx >= 0 ? s.slice(tIdx + 1) : s;
  const noTz = timePart.replace(/[Zz]$/, '').split(/[+.]/)[0] ?? timePart;
  const m = noTz.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return s;
  const hh = m[1].padStart(2, '0');
  return `${hh}:${m[2]}`;
}

/** Returns ` · HH:MM–HH:MM` when both start and end are present after stripping. */
export function formatOptionTimeRangeSuffix(start?: string | null, end?: string | null): string {
  const a = stripClockSeconds(start ?? '');
  const b = stripClockSeconds(end ?? '');
  if (!a || !b) return '';
  return ` · ${a}–${b}`;
}

export function formatDateWithOptionalTimeRange(date: string, start?: string | null, end?: string | null): string {
  return `${date}${formatOptionTimeRangeSuffix(start, end)}`;
}

/** Auto-message style: ` (HH:MM–HH:MM)` */
export function formatParenTimeRange(start?: string | null, end?: string | null): string {
  const a = stripClockSeconds(start ?? '');
  const b = stripClockSeconds(end ?? '');
  if (!a || !b) return '';
  return ` (${a}–${b})`;
}
