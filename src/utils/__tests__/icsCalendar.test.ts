import {
  escapeIcsText,
  foldIcsLine,
  eventToDtStartDtEnd,
  buildIcsCalendar,
  buildVeventLines,
  icsEventsFromExportPayload,
} from '../icsCalendar';

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
});
