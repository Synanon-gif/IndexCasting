import type { CalendarEntry } from '../../services/calendarSupabase';
import type { OptionRequest } from '../../store/optionRequests';
import { CALENDAR_COLORS } from '../calendarColors';
import {
  buildEventsByDateFromModelEntries,
  dedupeModelCalendarEntries,
  resolveModelCalendarEntryColor,
} from '../modelCalendarSchedule';

function entry(overrides: Partial<CalendarEntry>): CalendarEntry {
  const now = new Date().toISOString();
  return {
    id: 'ce-1',
    model_id: 'm1',
    date: '2026-04-15',
    start_time: null,
    end_time: null,
    title: 'Option',
    entry_type: 'option',
    status: 'tentative',
    booking_id: null,
    note: null,
    created_at: now,
    option_request_id: 'opt-1',
    ...overrides,
  };
}

function mockOption(over: Partial<OptionRequest> = {}): OptionRequest {
  return {
    id: 'opt-1',
    clientName: 'C',
    modelName: 'M',
    modelId: 'm1',
    date: '2026-04-15',
    createdAt: Date.now(),
    threadId: 'opt-1',
    status: 'confirmed',
    modelApproval: 'approved',
    finalStatus: 'job_confirmed',
    requestType: 'option',
    ...over,
  };
}

describe('buildEventsByDateFromModelEntries + store option projection', () => {
  it('uses B2B projection (job green) when store has finalStatus job_confirmed and entry is not tentative', () => {
    // Entry row can still be option-shaped; without projection, getCalendarEntryBlockColor is option orange.
    const e = entry({
      entry_type: 'option',
      title: 'Client shoot',
      status: 'booked',
    });
    const getOpt = () => mockOption({ finalStatus: 'job_confirmed' });
    const map = buildEventsByDateFromModelEntries([e], getOpt);
    const evs = map['2026-04-15'];
    expect(evs).toBeDefined();
    expect(evs![0].color).toBe(CALENDAR_COLORS.job);
    const withoutOpt = buildEventsByDateFromModelEntries([e], () => undefined);
    expect(withoutOpt['2026-04-15']![0].color).toBe(CALENDAR_COLORS.option);
  });

  it('resolveModelCalendarEntryColor matches buildEventsByDate color for same inputs', () => {
    const e = entry({ entry_type: 'option' });
    const getOpt = () => mockOption({ finalStatus: 'job_confirmed' });
    const fromHelper = resolveModelCalendarEntryColor(e, getOpt);
    const fromMap = buildEventsByDateFromModelEntries([e], getOpt)['2026-04-15']![0].color;
    expect(fromHelper).toBe(fromMap);
  });
});

describe('dedupeModelCalendarEntries', () => {
  it('keeps booking over option for the same option_request_id', () => {
    const older = entry({
      id: 'ce-old',
      entry_type: 'option',
      created_at: '2026-01-01T10:00:00.000Z',
    });
    const job = entry({
      id: 'ce-job',
      entry_type: 'booking',
      status: 'booked',
      title: 'Job',
      created_at: '2026-01-02T10:00:00.000Z',
    });
    const out = dedupeModelCalendarEntries([older, job]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('ce-job');
    expect(out[0].entry_type).toBe('booking');
  });

  it('replaces cancelled row with active row', () => {
    const cancelled = entry({
      id: 'ce-can',
      status: 'cancelled',
      entry_type: 'option',
      created_at: '2026-01-03T10:00:00.000Z',
    });
    const active = entry({
      id: 'ce-act',
      status: 'tentative',
      entry_type: 'option',
      created_at: '2026-01-02T10:00:00.000Z',
    });
    const out = dedupeModelCalendarEntries([cancelled, active]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('ce-act');
  });
});
