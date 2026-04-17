import { resolveCalendarRowOpenAction } from '../calendarRowOpenAction';
import type { UnifiedAgencyCalendarRow } from '../agencyCalendarUnified';
import type { AgencyCalendarItem, CalendarEntry } from '../../services/calendarSupabase';
import type { UserCalendarEvent } from '../../services/userCalendarEventsSupabase';

const OID_A = '550e8400-e29b-41d4-a716-446655440000';
const OID_B = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

function makeItem(optionId: string): AgencyCalendarItem {
  return {
    option: { id: optionId } as unknown as AgencyCalendarItem['option'],
    calendar_entry: null,
  } as unknown as AgencyCalendarItem;
}

function makeEntry(optionRequestId: string | null, id = 'entry-1'): CalendarEntry {
  return {
    id,
    option_request_id: optionRequestId,
    entry_type: 'booking',
    status: 'tentative',
  } as unknown as CalendarEntry;
}

function makeManualEv(id = 'manual-1'): UserCalendarEvent {
  return { id, title: 'Manual block' } as unknown as UserCalendarEvent;
}

const baseOptionRow = {
  kind: 'option' as const,
  sortKey: '0',
  id: 'opt-row-1',
  date: '2026-04-17',
  title: 'Option · Model',
  category: 'option' as const,
  effectiveAssigneeUserId: null,
  needsAgencyAction: false,
};

const baseBookingRow = {
  kind: 'booking' as const,
  sortKey: '1',
  id: 'book-row-1',
  date: '2026-04-17',
  title: 'Booking · Model',
  category: 'booking' as const,
  effectiveAssigneeUserId: null,
  needsAgencyAction: false,
};

const baseManualRow = {
  kind: 'manual' as const,
  sortKey: '2',
  id: 'manual-row-1',
  date: '2026-04-17',
  title: 'Personal',
};

describe('resolveCalendarRowOpenAction — canonical detail-first dispatch', () => {
  it('manual row → openManualEvent', () => {
    const ev = makeManualEv();
    const row: UnifiedAgencyCalendarRow = { ...baseManualRow, ev };
    const action = resolveCalendarRowOpenAction(row, new Map());
    expect(action).toEqual({ type: 'openManualEvent', ev });
  });

  it('option row → openDetails (always direct, never to chat)', () => {
    const item = makeItem(OID_A);
    const row: UnifiedAgencyCalendarRow = { ...baseOptionRow, item };
    const action = resolveCalendarRowOpenAction(row, new Map());
    expect(action).toEqual({ type: 'openDetails', item });
  });

  it('booking row WITH resolvable option_request_id → openDetails (regression fix)', () => {
    const item = makeItem(OID_A);
    const entry = makeEntry(OID_A);
    const row: UnifiedAgencyCalendarRow = { ...baseBookingRow, entry };
    const map = new Map<string, AgencyCalendarItem>([[OID_A, item]]);
    const action = resolveCalendarRowOpenAction(row, map);
    // Job/Casting bookings whose option still has a calendar item must route
    // to the detail overlay (Open Negotiation, BookingBriefEditor, notes), not
    // straight into chat.
    expect(action).toEqual({ type: 'openDetails', item });
  });

  it('booking row WITHOUT option_request_id → openBookingEntry (orphan fallback)', () => {
    const entry = makeEntry(null);
    const row: UnifiedAgencyCalendarRow = { ...baseBookingRow, entry };
    const action = resolveCalendarRowOpenAction(row, new Map());
    expect(action).toEqual({ type: 'openBookingEntry', entry });
  });

  it('booking row with option_request_id but no item in map → openBookingEntry (defensive fallback)', () => {
    const entry = makeEntry(OID_B);
    const row: UnifiedAgencyCalendarRow = { ...baseBookingRow, entry };
    const action = resolveCalendarRowOpenAction(row, new Map());
    expect(action).toEqual({ type: 'openBookingEntry', entry });
  });

  it('booking row resolves correct item when map contains multiple', () => {
    const itemA = makeItem(OID_A);
    const itemB = makeItem(OID_B);
    const entry = makeEntry(OID_B);
    const row: UnifiedAgencyCalendarRow = { ...baseBookingRow, entry };
    const map = new Map<string, AgencyCalendarItem>([
      [OID_A, itemA],
      [OID_B, itemB],
    ]);
    const action = resolveCalendarRowOpenAction(row, map);
    expect(action).toEqual({ type: 'openDetails', item: itemB });
  });

  it('NEVER dispatches a chat-only path for option rows', () => {
    const item = makeItem(OID_A);
    const row: UnifiedAgencyCalendarRow = { ...baseOptionRow, item };
    const action = resolveCalendarRowOpenAction(row, new Map());
    expect(action.type).not.toBe('openBookingEntry');
    expect(action.type).toBe('openDetails');
  });

  it('NEVER dispatches openBookingEntry for booking rows whose option detail is available', () => {
    const item = makeItem(OID_A);
    const entry = makeEntry(OID_A);
    const row: UnifiedAgencyCalendarRow = { ...baseBookingRow, entry };
    const map = new Map<string, AgencyCalendarItem>([[OID_A, item]]);
    const action = resolveCalendarRowOpenAction(row, map);
    expect(action.type).not.toBe('openBookingEntry');
  });
});
