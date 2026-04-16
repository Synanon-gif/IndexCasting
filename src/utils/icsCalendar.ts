/**
 * RFC 5545 iCalendar (ICS) builder — Google Calendar / Apple Calendar compatible.
 * Uses floating local date-times (no trailing Z) when times are present so the
 * subscriber's device timezone applies; all-day uses VALUE=DATE.
 */

export type IcsCalendarEventInput = {
  /** Stable unique id (e.g. kind + uuid) */
  uid: string;
  title: string;
  description?: string;
  /** YYYY-MM-DD */
  date: string;
  startTime?: string | null;
  endTime?: string | null;
};

const CRLF = '\r\n';

/** Fold long lines per RFC 5545 (octets; conservative 73 chars for ASCII). */
export function foldIcsLine(line: string): string {
  if (line.length <= 73) return line;
  const parts: string[] = [];
  let rest = line;
  let first = true;
  while (rest.length > 0) {
    const max = first ? 73 : 72;
    parts.push(rest.slice(0, max));
    rest = rest.slice(max);
    first = false;
    if (rest.length > 0) rest = ` ${rest}`;
  }
  return parts.join(CRLF);
}

export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');
}

function normalizeTimeToHms(t: string | null | undefined): string | null {
  if (t == null || String(t).trim() === '') return null;
  const s = String(t).trim();
  const m = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const hh = m[1].padStart(2, '0');
  const mm = m[2];
  const ss = (m[3] ?? '00').padStart(2, '0');
  return `${hh}${mm}${ss}`;
}

function dateOnlyCompact(yyyyMmDd: string): string {
  return yyyyMmDd.replace(/-/g, '');
}

/**
 * Build DTSTART / DTEND lines (floating local or all-day).
 */
export function eventToDtStartDtEnd(input: IcsCalendarEventInput): {
  dtStart: string;
  dtEnd: string;
} {
  const d = dateOnlyCompact(input.date);
  const st = normalizeTimeToHms(input.startTime);
  const et = normalizeTimeToHms(input.endTime);

  if (!st) {
    const start = `DTSTART;VALUE=DATE:${d}`;
    const next = addOneDayToYyyymmdd(d);
    const end = `DTEND;VALUE=DATE:${next}`;
    return { dtStart: start, dtEnd: end };
  }

  const dtStart = `DTSTART:${d}T${st}`;
  let endHms = et;
  if (!endHms) {
    const add1h = addOneHourToDateTime(d, st);
    endHms = add1h.hms;
    return {
      dtStart,
      dtEnd: `DTEND:${add1h.ymd}T${endHms}`,
    };
  }
  return {
    dtStart,
    dtEnd: `DTEND:${d}T${endHms}`,
  };
}

function addOneDayToYyyymmdd(ymd: string): string {
  const y = Number(ymd.slice(0, 4));
  const mo = Number(ymd.slice(4, 6)) - 1;
  const day = Number(ymd.slice(6, 8));
  const dt = new Date(Date.UTC(y, mo, day + 1));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}${mm}${dd}`;
}

function addOneHourToDateTime(ymdCompact: string, hms: string): { ymd: string; hms: string } {
  const y = Number(ymdCompact.slice(0, 4));
  const mo = Number(ymdCompact.slice(4, 6)) - 1;
  const day = Number(ymdCompact.slice(6, 8));
  const hh = Number(hms.slice(0, 2));
  const mm = Number(hms.slice(2, 4));
  const ss = Number(hms.slice(4, 6));
  const dt = new Date(Date.UTC(y, mo, day, hh + 1, mm, ss));
  const yy = dt.getUTCFullYear();
  const mo1 = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  const H = String(dt.getUTCHours()).padStart(2, '0');
  const M = String(dt.getUTCMinutes()).padStart(2, '0');
  const S = String(dt.getUTCSeconds()).padStart(2, '0');
  return { ymd: `${yy}${mo1}${dd}`, hms: `${H}${M}${S}` };
}

export function buildVeventLines(
  input: IcsCalendarEventInput,
  opts?: { domain?: string },
): string[] {
  const domain = opts?.domain ?? 'indexcasting.calendar';
  const { dtStart, dtEnd } = eventToDtStartDtEnd(input);
  const uid = `${input.uid.replace(/[^a-zA-Z0-9-@._]/g, '')}@${domain}`;
  const stamp =
    new Date()
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d{3}Z$/, 'Z') ?? '';

  const lines = [
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${stamp}`,
    foldIcsLine(`SUMMARY:${escapeIcsText(input.title)}`),
    foldIcsLine(`DESCRIPTION:${escapeIcsText(input.description ?? '')}`),
    dtStart,
    dtEnd,
    'END:VEVENT',
  ];
  return lines;
}

export function buildIcsCalendar(
  events: IcsCalendarEventInput[],
  opts?: { calName?: string; domain?: string },
): string {
  const header = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//IndexCasting//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];
  if (opts?.calName) {
    header.push(foldIcsLine(`X-WR-CALNAME:${escapeIcsText(opts.calName)}`));
  }

  const body: string[] = [];
  for (const ev of events) {
    body.push(...buildVeventLines(ev, { domain: opts?.domain }));
  }

  const all = [...header, ...body, 'END:VCALENDAR'];
  return all.join(CRLF);
}

/** Map RPC payload items from get_calendar_export_payload_for_me / feed JSON. */
export function icsEventsFromExportPayload(raw: unknown): IcsCalendarEventInput[] {
  if (!raw || typeof raw !== 'object') return [];
  const o = raw as Record<string, unknown>;
  const events = o.events;
  if (!Array.isArray(events)) return [];

  const out: IcsCalendarEventInput[] = [];
  for (const row of events) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const kind = String(r.kind ?? '');
    const id = String(r.id ?? '');
    if (!id) continue;
    const date = String(r.date ?? '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;

    out.push({
      uid: `${kind}-${id}`,
      title: String(r.title ?? 'Event'),
      description: String(r.description ?? ''),
      date,
      startTime: r.startTime != null ? String(r.startTime) : null,
      endTime: r.endTime != null ? String(r.endTime) : null,
    });
  }
  return out;
}
