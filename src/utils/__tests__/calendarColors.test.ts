import { CALENDAR_COLORS, calendarEntryColor, OPTION_REQUEST_CHAT_STATUS_COLORS } from '../calendarColors';

describe('calendarColors', () => {
  it('calendarEntryColor maps known entry types', () => {
    expect(calendarEntryColor('option')).toBe(CALENDAR_COLORS.option);
    expect(calendarEntryColor('booking')).toBe(CALENDAR_COLORS.booking);
    expect(calendarEntryColor('unknown_type')).toBe(CALENDAR_COLORS.personal);
    expect(calendarEntryColor(undefined)).toBe(CALENDAR_COLORS.personal);
  });

  it('OPTION_REQUEST_CHAT_STATUS_COLORS covers all chat statuses used in Messages lists', () => {
    expect(OPTION_REQUEST_CHAT_STATUS_COLORS.in_negotiation).toMatch(/^#/);
    expect(OPTION_REQUEST_CHAT_STATUS_COLORS.confirmed).toMatch(/^#/);
    expect(OPTION_REQUEST_CHAT_STATUS_COLORS.rejected).toMatch(/^#/);
  });
});
