import {
  stripClockSeconds,
  formatOptionTimeRangeSuffix,
  formatDateWithOptionalTimeRange,
  formatParenTimeRange,
} from '../formatTimeForUi';

describe('formatTimeForUi', () => {
  it('maps HH:MM:SS to HH:MM', () => {
    expect(stripClockSeconds('01:00:00')).toBe('01:00');
    expect(stripClockSeconds('02:30:00')).toBe('02:30');
  });

  it('formats range suffix without seconds', () => {
    expect(formatOptionTimeRangeSuffix('01:00:00', '02:00:00')).toBe(' · 01:00–02:00');
    expect(formatOptionTimeRangeSuffix('02:30:00', '03:45:00')).toBe(' · 02:30–03:45');
  });

  it('formatDateWithOptionalTimeRange joins date and range', () => {
    expect(formatDateWithOptionalTimeRange('2026-04-12', '01:00:00', '02:00:00')).toBe(
      '2026-04-12 · 01:00–02:00',
    );
  });

  it('formatParenTimeRange for auto text', () => {
    expect(formatParenTimeRange('01:00:00', '02:00:00')).toBe(' (01:00–02:00)');
  });

  it('returns empty suffix when start or end missing', () => {
    expect(formatOptionTimeRangeSuffix('01:00:00', null)).toBe('');
    expect(formatOptionTimeRangeSuffix('', '02:00:00')).toBe('');
  });
});
