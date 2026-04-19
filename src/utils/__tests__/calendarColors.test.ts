import {
  CALENDAR_COLORS,
  CALENDAR_PROJECTION_COLORS,
  calendarEntryColor,
  OPTION_REQUEST_CHAT_STATUS_COLORS,
} from '../calendarColors';

describe('calendarColors', () => {
  it('calendarEntryColor maps known entry types', () => {
    expect(calendarEntryColor('option')).toBe(CALENDAR_COLORS.option);
    expect(calendarEntryColor('booking')).toBe(CALENDAR_COLORS.booking);
    expect(calendarEntryColor('casting')).toBe(CALENDAR_COLORS.casting);
    expect(calendarEntryColor('unknown_type')).toBe(CALENDAR_COLORS.personal);
    expect(calendarEntryColor(undefined)).toBe(CALENDAR_COLORS.personal);
  });

  it('CALENDAR_PROJECTION_COLORS matches month-dot / badge semantics', () => {
    expect(CALENDAR_PROJECTION_COLORS.awaitingModel).toMatch(/^#/);
    expect(CALENDAR_PROJECTION_COLORS.jobConfirmationPending).toMatch(/^#/);
    expect(CALENDAR_PROJECTION_COLORS.rejected).toMatch(/^#/);
  });

  it('OPTION_REQUEST_CHAT_STATUS_COLORS covers all chat statuses used in Messages lists', () => {
    expect(OPTION_REQUEST_CHAT_STATUS_COLORS.in_negotiation).toMatch(/^#/);
    expect(OPTION_REQUEST_CHAT_STATUS_COLORS.confirmed).toMatch(/^#/);
    expect(OPTION_REQUEST_CHAT_STATUS_COLORS.rejected).toMatch(/^#/);
  });
});
