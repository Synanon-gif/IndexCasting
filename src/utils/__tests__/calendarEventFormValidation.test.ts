import {
  isStrictIsoDate,
  parseCalendarEventDate,
  validateCalendarEventForm,
} from '../calendarEventFormValidation';

describe('parseCalendarEventDate', () => {
  it('accepts valid ISO YYYY-MM-DD', () => {
    expect(parseCalendarEventDate('2025-05-27')).toEqual({ ok: true, iso: '2025-05-27' });
  });

  it('rejects swapped ISO segments like 2025-27-05', () => {
    expect(parseCalendarEventDate('2025-27-05')).toEqual({ ok: false });
  });

  it('rejects empty date', () => {
    expect(parseCalendarEventDate('')).toEqual({ ok: false });
  });

  it('rejects invalid month/day rollover (2025-02-31)', () => {
    expect(parseCalendarEventDate('2025-02-31')).toEqual({ ok: false });
  });

  it('converts DD-MM-YYYY to ISO', () => {
    expect(parseCalendarEventDate('27-05-2025')).toEqual({ ok: true, iso: '2025-05-27' });
  });
});

describe('isStrictIsoDate', () => {
  it('returns true for valid ISO dates only', () => {
    expect(isStrictIsoDate('2025-05-27')).toBe(true);
    expect(isStrictIsoDate('2025-27-05')).toBe(false);
  });
});

describe('validateCalendarEventForm', () => {
  const base = {
    date: '2025-05-27',
    startTime: '15:00',
    endTime: '17:00',
    eventCategory: 'option' as const,
    selectedModelIds: ['model-1'],
    title: 'Test shoot',
  };

  it('accepts valid option with one model', () => {
    const r = validateCalendarEventForm(base);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.isoDate).toBe('2025-05-27');
  });

  it('accepts valid option with multiple models', () => {
    const r = validateCalendarEventForm({
      ...base,
      selectedModelIds: ['a', 'b'],
    });
    expect(r.ok).toBe(true);
  });

  it('accepts private event without models', () => {
    const r = validateCalendarEventForm({
      ...base,
      eventCategory: 'private',
      selectedModelIds: [],
    });
    expect(r.ok).toBe(true);
  });

  it('rejects invalid date 2025-27-05', () => {
    const r = validateCalendarEventForm({ ...base, date: '2025-27-05' });
    expect(r).toEqual({ ok: false, errorKey: 'invalid_date' });
  });

  it('rejects end <= start', () => {
    const r = validateCalendarEventForm({
      ...base,
      startTime: '17:00',
      endTime: '15:00',
    });
    expect(r).toEqual({ ok: false, errorKey: 'end_before_start' });
  });

  it('rejects option/casting without models', () => {
    const r = validateCalendarEventForm({
      ...base,
      selectedModelIds: [],
    });
    expect(r).toEqual({ ok: false, errorKey: 'models_required' });
  });

  it('rejects casting without models', () => {
    const r = validateCalendarEventForm({
      ...base,
      eventCategory: 'casting',
      selectedModelIds: [],
    });
    expect(r).toEqual({ ok: false, errorKey: 'models_required' });
  });
});
