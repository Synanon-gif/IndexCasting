import {
  isCalendarThreadUuid,
  resolveCanonicalOptionRequestIdForCalendarItem,
  resolveCanonicalOptionRequestIdForCalendarThread,
  resolveCanonicalOptionRequestIdFromBookingCalendarEntry,
} from '../calendarThreadDeepLink';

const OID = '550e8400-e29b-41d4-a716-446655440000';
const OTHER = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

describe('isCalendarThreadUuid', () => {
  it('accepts RFC variant UUIDs', () => {
    expect(isCalendarThreadUuid(OID)).toBe(true);
  });

  it('rejects nil and malformed', () => {
    expect(isCalendarThreadUuid(null)).toBe(false);
    expect(isCalendarThreadUuid('not-a-uuid')).toBe(false);
  });
});

describe('resolveCanonicalOptionRequestIdForCalendarThread', () => {
  it('prefers calendar_entries.option_request_id when option id matches', () => {
    expect(resolveCanonicalOptionRequestIdForCalendarThread(OID, OID)).toBe(OID);
  });

  it('uses option id when calendar entry has no option_request_id', () => {
    expect(resolveCanonicalOptionRequestIdForCalendarThread(OID, null)).toBe(OID);
  });

  it('uses calendar entry id when option id missing', () => {
    expect(resolveCanonicalOptionRequestIdForCalendarThread('', OID)).toBe(OID);
    expect(resolveCanonicalOptionRequestIdForCalendarThread(undefined, OID)).toBe(OID);
  });

  it('returns null when both set but differ (fail closed)', () => {
    expect(resolveCanonicalOptionRequestIdForCalendarThread(OID, OTHER)).toBe(null);
  });

  it('returns null when neither side is a valid UUID', () => {
    expect(resolveCanonicalOptionRequestIdForCalendarThread('bad', 'also-bad')).toBe(null);
  });
});

describe('resolveCanonicalOptionRequestIdForCalendarItem', () => {
  it('merges option + calendar_entry like thread resolver', () => {
    expect(
      resolveCanonicalOptionRequestIdForCalendarItem({
        option: { id: OID },
        calendar_entry: { option_request_id: OID },
      }),
    ).toBe(OID);
    expect(
      resolveCanonicalOptionRequestIdForCalendarItem({
        option: { id: OID },
        calendar_entry: null,
      }),
    ).toBe(OID);
  });
});

describe('resolveCanonicalOptionRequestIdFromBookingCalendarEntry', () => {
  it('uses only option_request_id', () => {
    expect(resolveCanonicalOptionRequestIdFromBookingCalendarEntry({ option_request_id: OID })).toBe(OID);
    expect(resolveCanonicalOptionRequestIdFromBookingCalendarEntry({ option_request_id: null })).toBe(null);
  });
});
