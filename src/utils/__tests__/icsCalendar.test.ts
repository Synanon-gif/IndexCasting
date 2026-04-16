import {
  escapeIcsText,
  foldIcsLine,
  eventToDtStartDtEnd,
  buildIcsCalendar,
  buildVeventLines,
  icsEventsFromExportPayload,
} from '../icsCalendar';
import {
  BOOKING_EVENT,
  CALENDAR_ENTRY_BOOKING,
  USER_CALENDAR_EVENT_MIRROR,
} from '../../constants/calendarSourcePriority';

describe('escapeIcsText', () => {
  it('escapes RFC 5545 special characters', () => {
    expect(escapeIcsText('a\\b,c;d\ne')).toBe('a\\\\b\\,c\\;d\\ne');
  });
});

describe('foldIcsLine', () => {
  it('returns short lines unchanged', () => {
    expect(foldIcsLine('SHORT')).toBe('SHORT');
  });

  it('folds long lines with CRLF and leading space on continuations', () => {
    const long = 'A'.repeat(80);
    const folded = foldIcsLine(long);
    expect(folded).toContain('\r\n ');
    expect(folded.startsWith('AAA')).toBe(true);
    const lines = folded.split('\r\n');
    expect(lines[0].length).toBeLessThanOrEqual(73);
    for (let i = 1; i < lines.length; i++) {
      expect(lines[i].startsWith(' ')).toBe(true);
      expect(lines[i].length).toBeLessThanOrEqual(73);
    }
  });
});

describe('eventToDtStartDtEnd', () => {
  it('uses all-day when no start time', () => {
    const { dtStart, dtEnd } = eventToDtStartDtEnd({
      uid: 'x',
      title: 'T',
      date: '2026-04-16',
    });
    expect(dtStart).toBe('DTSTART;VALUE=DATE:20260416');
    expect(dtEnd).toMatch(/^DTEND;VALUE=DATE:20260417$/);
  });

  it('builds floating local DTSTART/DTEND when times present', () => {
    const { dtStart, dtEnd } = eventToDtStartDtEnd({
      uid: 'x',
      title: 'T',
      date: '2026-04-16',
      startTime: '9:30',
      endTime: '11:00',
    });
    expect(dtStart).toBe('DTSTART:20260416T093000');
    expect(dtEnd).toBe('DTEND:20260416T110000');
  });

  it('accepts PostgreSQL-style HH:MM:SS strings', () => {
    const { dtStart, dtEnd } = eventToDtStartDtEnd({
      uid: 'x',
      title: 'T',
      date: '2026-04-16',
      startTime: '09:00:00',
      endTime: '10:30:00',
    });
    expect(dtStart).toBe('DTSTART:20260416T090000');
    expect(dtEnd).toBe('DTEND:20260416T103000');
  });

  it('defaults end to +1h when end time missing', () => {
    const { dtStart, dtEnd } = eventToDtStartDtEnd({
      uid: 'x',
      title: 'T',
      date: '2026-04-16',
      startTime: '14:00',
    });
    expect(dtStart).toBe('DTSTART:20260416T140000');
    expect(dtEnd).toBe('DTEND:20260416T150000');
  });
});

describe('buildIcsCalendar', () => {
  it('uses CRLF between lines and ends with END:VCALENDAR', () => {
    const ics = buildIcsCalendar(
      [
        {
          uid: 'e1',
          title: 'Hello, world',
          date: '2026-01-01',
          startTime: '10:00',
          endTime: '11:00',
        },
      ],
      { calName: 'Test Cal' },
    );
    expect(ics.includes('\r\n')).toBe(true);
    expect(ics.endsWith('\r\nEND:VCALENDAR')).toBe(true);
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('X-WR-CALNAME:Test Cal');
    expect(ics).toContain('SUMMARY:Hello\\, world');
  });

  it('escapes Unicode in SUMMARY for RFC5545 TEXT', () => {
    const ics = buildIcsCalendar(
      [
        {
          uid: 'u1',
          title: 'München — Casting',
          date: '2026-06-01',
          startTime: '12:00',
          endTime: '13:00',
        },
      ],
      { calName: 'Café' },
    );
    expect(ics).toContain('SUMMARY:München');
    expect(ics).toContain('X-WR-CALNAME:Café');
  });

  it('emits two VEVENT blocks in payload order', () => {
    const ics = buildIcsCalendar(
      [
        { uid: 'a', title: 'First', date: '2026-01-02', startTime: '10:00', endTime: '11:00' },
        { uid: 'b', title: 'Second', date: '2026-01-03', startTime: '10:00', endTime: '11:00' },
      ],
      {},
    );
    const first = ics.indexOf('SUMMARY:First');
    const second = ics.indexOf('SUMMARY:Second');
    expect(first).toBeGreaterThan(-1);
    expect(second).toBeGreaterThan(first);
  });
});

describe('buildVeventLines', () => {
  it('sanitizes uid for @domain part', () => {
    const lines = buildVeventLines(
      { uid: 'bad id!@#', title: 'T', date: '2026-06-01' },
      { domain: 'example.com' },
    );
    const uidLine = lines.find((l) => l.startsWith('UID:'));
    expect(uidLine).toBeDefined();
    expect(uidLine).toContain('@example.com');
  });
});

describe('icsEventsFromExportPayload', () => {
  it('maps RPC-shaped JSON to event inputs', () => {
    const raw = {
      events: [
        {
          kind: 'user_calendar_events',
          id: '11111111-1111-1111-1111-111111111111',
          title: 'Option',
          description: 'Note',
          date: '2026-04-20',
          startTime: '09:00',
          endTime: '10:00',
        },
      ],
    };
    const evs = icsEventsFromExportPayload(raw);
    expect(evs).toHaveLength(1);
    expect(evs[0].uid).toBe('user_calendar_events-11111111-1111-1111-1111-111111111111');
    expect(evs[0].title).toBe('Option');
  });

  it('skips invalid rows', () => {
    expect(icsEventsFromExportPayload(null)).toEqual([]);
    expect(icsEventsFromExportPayload({ events: [{ id: '', date: '2026-01-01' }] })).toEqual([]);
    expect(icsEventsFromExportPayload({ events: [{ id: 'x', date: 'not-a-date' }] })).toEqual([]);
  });

  it('maps null startTime/endTime to ICS inputs', () => {
    const evs = icsEventsFromExportPayload({
      events: [
        {
          kind: 'calendar_entries',
          id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
          title: 'All day',
          description: '',
          date: '2026-05-01',
          startTime: null,
          endTime: null,
        },
      ],
    });
    expect(evs).toHaveLength(1);
    expect(evs[0].startTime).toBeNull();
    expect(evs[0].endTime).toBeNull();
  });

  it('dedupes by optionRequestId keeping booking_events over calendar_entries job', () => {
    const optId = '22222222-2222-2222-2222-222222222222';
    const raw = {
      events: [
        {
          kind: 'calendar_entries',
          id: '33333333-3333-3333-3333-333333333333',
          title: 'Job – Client',
          description: '',
          date: '2026-04-20',
          startTime: '09:00',
          endTime: '10:00',
          optionRequestId: optId,
          sourcePriority: CALENDAR_ENTRY_BOOKING,
        },
        {
          kind: 'booking_events',
          id: '44444444-4444-4444-4444-444444444444',
          title: 'Job booking',
          description: '',
          date: '2026-04-20',
          startTime: null,
          endTime: null,
          optionRequestId: optId,
          sourcePriority: BOOKING_EVENT,
        },
      ],
    };
    const evs = icsEventsFromExportPayload(raw);
    expect(evs).toHaveLength(1);
    expect(evs[0].title).toBe('Job booking');
    expect(evs[0].uid).toBe(`opt:${optId}`);
  });

  it('dedupes by optionRequestId keeping lowest sourcePriority (job over mirror)', () => {
    const optId = '22222222-2222-2222-2222-222222222222';
    const raw = {
      events: [
        {
          kind: 'user_calendar_events',
          id: '11111111-1111-1111-1111-111111111111',
          title: 'Mirror option',
          description: '',
          date: '2026-04-20',
          startTime: '09:00',
          endTime: '10:00',
          optionRequestId: optId,
          sourcePriority: USER_CALENDAR_EVENT_MIRROR,
        },
        {
          kind: 'calendar_entries',
          id: '33333333-3333-3333-3333-333333333333',
          title: 'Job – Client',
          description: '',
          date: '2026-04-20',
          startTime: '09:00',
          endTime: '10:00',
          optionRequestId: optId,
          sourcePriority: CALENDAR_ENTRY_BOOKING,
        },
      ],
    };
    const evs = icsEventsFromExportPayload(raw);
    expect(evs).toHaveLength(1);
    expect(evs[0].title).toBe('Job – Client');
    expect(evs[0].uid).toBe(`opt:${optId}`);
  });
});
