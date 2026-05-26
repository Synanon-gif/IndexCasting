export type CalendarEventCategory = 'option' | 'casting' | 'private';

export type CalendarEventFormInput = {
  date: string;
  startTime: string;
  endTime: string;
  eventCategory: CalendarEventCategory;
  selectedModelIds: string[];
  title: string;
};

export type CalendarEventFormValidationErrorKey =
  | 'missing_title'
  | 'missing_date'
  | 'invalid_date'
  | 'date_too_far_from_today'
  | 'invalid_time'
  | 'end_before_start'
  | 'models_required';

/** Agency manual calendar events: block dates more than one year from today (UI guard only). */
export const CALENDAR_EVENT_MAX_DAYS_FROM_TODAY = 365;

export type CalendarEventFormValidationResult =
  | {
      ok: true;
      isoDate: string;
      startTime: string;
      endTime: string;
    }
  | {
      ok: false;
      errorKey: CalendarEventFormValidationErrorKey;
    };

function pad2(n: number): string {
  return n >= 10 ? String(n) : `0${n}`;
}

function isValidYmd(y: number, m: number, d: number): boolean {
  if (!Number.isFinite(y) || y < 1 || y > 9999) return false;
  if (!Number.isFinite(m) || m < 1 || m > 12) return false;
  if (!Number.isFinite(d) || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Strict ISO YYYY-MM-DD with real calendar date (no Date.parse rollover). */
export function isStrictIsoDate(value: string): boolean {
  return parseCalendarEventDate(value).ok;
}

/**
 * Parses calendar event dates for agency add-event form.
 * - YYYY-MM-DD: strict month/day (rejects 2025-27-05, 2025-02-31).
 * - DD-MM-YYYY / DD.MM.YYYY / DD/MM/YYYY: EU-style conversion (legacy UX).
 */
export function parseCalendarEventDate(raw: string): { ok: true; iso: string } | { ok: false } {
  const s = raw.trim();
  if (!s) return { ok: false };

  const isoMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    const y = Number(isoMatch[1]);
    const mo = Number(isoMatch[2]);
    const d = Number(isoMatch[3]);
    if (isValidYmd(y, mo, d)) {
      return { ok: true, iso: `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}` };
    }
    return { ok: false };
  }

  const ddMmYyyy = s.match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})$/);
  if (ddMmYyyy) {
    const d = Number(ddMmYyyy[1]);
    const mo = Number(ddMmYyyy[2]);
    const y = Number(ddMmYyyy[3]);
    if (isValidYmd(y, mo, d)) {
      return { ok: true, iso: `${y}-${pad2(mo)}-${pad2(d)}` };
    }
    return { ok: false };
  }

  return { ok: false };
}

/** Day distance between two ISO dates (UTC noon avoids DST edge cases). */
export function daysBetweenIsoDates(isoA: string, isoB: string): number {
  const a = new Date(`${isoA}T12:00:00.000Z`);
  const b = new Date(`${isoB}T12:00:00.000Z`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.abs(Math.round((a.getTime() - b.getTime()) / 86_400_000));
}

export function todayIsoLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function isCalendarEventDateWithinPlausibleRange(
  isoDate: string,
  referenceTodayIso: string = todayIsoLocal(),
): boolean {
  return daysBetweenIsoDates(isoDate, referenceTodayIso) <= CALENDAR_EVENT_MAX_DAYS_FROM_TODAY;
}

const TIME_RE = /^\d{2}:\d{2}$/;

function parseTimeMinutes(value: string): number | null {
  const t = value.trim();
  if (!t) return null;
  if (!TIME_RE.test(t)) return null;
  const [hh, mm] = t.split(':').map(Number);
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}

export function validateCalendarEventForm(
  input: CalendarEventFormInput,
): CalendarEventFormValidationResult {
  const title = input.title.trim();
  if (!title) return { ok: false, errorKey: 'missing_title' };

  const rawDate = input.date.trim();
  if (!rawDate) return { ok: false, errorKey: 'missing_date' };

  const parsedDate = parseCalendarEventDate(rawDate);
  if (!parsedDate.ok) return { ok: false, errorKey: 'invalid_date' };

  if (!isCalendarEventDateWithinPlausibleRange(parsedDate.iso)) {
    return { ok: false, errorKey: 'date_too_far_from_today' };
  }

  const startTime = input.startTime.trim();
  const endTime = input.endTime.trim();

  if (
    (startTime && !TIME_RE.test(startTime)) ||
    (endTime && !TIME_RE.test(endTime)) ||
    (startTime && parseTimeMinutes(startTime) === null) ||
    (endTime && parseTimeMinutes(endTime) === null)
  ) {
    return { ok: false, errorKey: 'invalid_time' };
  }

  const startMin = parseTimeMinutes(startTime);
  const endMin = parseTimeMinutes(endTime);
  if (startMin !== null && endMin !== null && endMin <= startMin) {
    return { ok: false, errorKey: 'end_before_start' };
  }

  if (input.eventCategory !== 'private' && input.selectedModelIds.length === 0) {
    return { ok: false, errorKey: 'models_required' };
  }

  return {
    ok: true,
    isoDate: parsedDate.iso,
    startTime,
    endTime,
  };
}
