import type { CalendarEntry } from '../../services/calendarSupabase';
import { dedupeModelCalendarEntries } from '../modelCalendarSchedule';

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
