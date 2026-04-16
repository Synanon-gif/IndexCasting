import type { AgencyCalendarItem, CalendarEntry } from '../../services/calendarSupabase';
import type { SupabaseOptionRequest } from '../../services/optionRequestsSupabase';
import type { UserCalendarEvent } from '../../services/userCalendarEventsSupabase';
import {
  buildUnifiedAgencyCalendarRows,
  CALENDAR_SOURCE_PRIORITY_ORDER_FOR_AUDIT,
  dedupeUnifiedRowsByOptionRequest,
  filterUnifiedAgencyCalendarRows,
  preferJobBookingOverOptionRows,
} from '../agencyCalendarUnified';
import {
  BOOKING_EVENT,
  CALENDAR_ENTRY_BOOKING,
  CALENDAR_ENTRY_OPTION,
  USER_CALENDAR_EVENT_MIRROR,
  USER_CALENDAR_EVENT_MANUAL,
} from '../../constants/calendarSourcePriority';

function minimalOption(overrides: Partial<SupabaseOptionRequest>): SupabaseOptionRequest {
  const now = new Date().toISOString();
  return {
    id: 'opt-1',
    client_id: 'c1',
    model_id: 'm1',
    agency_id: 'a1',
    requested_date: '2026-04-15',
    status: 'in_negotiation',
    project_id: null,
    client_name: 'Client Co',
    model_name: 'Model',
    job_description: null,
    proposed_price: 100,
    agency_counter_price: null,
    client_price_status: 'pending',
    final_status: 'option_pending',
    request_type: 'option',
    currency: 'EUR',
    start_time: null,
    end_time: null,
    model_approval: 'pending',
    model_approved_at: null,
    model_account_linked: true,
    booker_id: null,
    organization_id: 'org-client',
    agency_organization_id: 'org-agency',
    client_organization_id: 'org-client',
    client_organization_name: null,
    agency_organization_name: null,
    created_by: null,
    agency_assignee_user_id: null,
    created_at: now,
    updated_at: now,
    is_agency_only: false,
    ...overrides,
  };
}

function calendarEntry(overrides: Partial<CalendarEntry>): CalendarEntry {
  const now = new Date().toISOString();
  return {
    id: 'ce-1',
    model_id: 'm1',
    date: '2026-04-15',
    start_time: null,
    end_time: null,
    title: 'Option – Client Co',
    entry_type: 'option',
    status: 'tentative',
    booking_id: null,
    note: null,
    created_at: now,
    option_request_id: 'opt-1',
    ...overrides,
  };
}

function manualEv(overrides: Partial<UserCalendarEvent>): UserCalendarEvent {
  const now = new Date().toISOString();
  return {
    id: 'uce-1',
    owner_id: 'a1',
    owner_type: 'agency',
    date: '2026-04-15',
    start_time: null,
    end_time: null,
    title: 'Job – Client Co',
    color: '#2E7D32',
    note: null,
    organization_id: null,
    created_by: null,
    source_option_request_id: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

function itemByOptionId(items: AgencyCalendarItem[]): Map<string, AgencyCalendarItem> {
  return new Map(items.map((i) => [i.option.id, i]));
}

describe('agencyCalendarUnified — priority parity with calendarSourcePriority', () => {
  it('CALENDAR_SOURCE_PRIORITY_ORDER_FOR_AUDIT matches SQL/ICS ordering (lower index wins)', () => {
    expect([...CALENDAR_SOURCE_PRIORITY_ORDER_FOR_AUDIT]).toEqual([
      BOOKING_EVENT,
      CALENDAR_ENTRY_BOOKING,
      CALENDAR_ENTRY_OPTION,
      USER_CALENDAR_EVENT_MIRROR,
      USER_CALENDAR_EVENT_MANUAL,
    ]);
  });
});

describe('buildUnifiedAgencyCalendarRows — user_calendar_events mirror dedupe', () => {
  it('suppresses manual row when source_option_request_id matches a loaded option', () => {
    const optId = 'opt-dedupe-a';
    const opt = minimalOption({ id: optId });
    const item: AgencyCalendarItem = {
      option: opt,
      calendar_entry: calendarEntry({ option_request_id: optId, id: 'ce-a' }),
    };
    const mirror = manualEv({
      id: 'uce-mirror',
      source_option_request_id: optId,
      title: 'Job – Client Co',
    });
    const rows = buildUnifiedAgencyCalendarRows([item], [], [mirror], {}, itemByOptionId([item]));
    expect(rows.filter((r) => r.kind === 'option')).toHaveLength(1);
    expect(rows.filter((r) => r.kind === 'manual')).toHaveLength(0);
  });

  it('prefers job booking row over option row when booking_events-derived entry exists', () => {
    const optId = 'opt-dedupe-b';
    const opt = minimalOption({ id: optId });
    const item: AgencyCalendarItem = {
      option: opt,
      calendar_entry: calendarEntry({ option_request_id: optId, id: 'ce-b' }),
    };
    const mirror = manualEv({
      id: 'uce-mirror-b',
      source_option_request_id: optId,
      title: 'Job – Client Co',
    });
    const beEntry: CalendarEntry = {
      id: 'be:be-1',
      model_id: 'm1',
      date: '2026-04-15',
      start_time: null,
      end_time: null,
      title: 'Job – Client Co',
      entry_type: 'booking',
      status: 'booked',
      booking_id: null,
      note: null,
      created_at: new Date().toISOString(),
      option_request_id: optId,
    };
    const rows = preferJobBookingOverOptionRows(
      buildUnifiedAgencyCalendarRows([item], [beEntry], [mirror], {}, itemByOptionId([item])),
    );
    expect(rows.filter((r) => r.kind === 'option')).toHaveLength(0);
    expect(rows.filter((r) => r.kind === 'booking')).toHaveLength(1);
    expect(rows.filter((r) => r.kind === 'manual')).toHaveLength(0);
  });

  it('keeps mirror when no matching option is in items (orphan / outside fetch window)', () => {
    const optId = 'opt-missing';
    const mirror = manualEv({
      source_option_request_id: optId,
      title: 'Job – Client Co',
    });
    const rows = buildUnifiedAgencyCalendarRows([], [], [mirror], {}, new Map());
    expect(rows.filter((r) => r.kind === 'manual')).toHaveLength(1);
    expect(rows.filter((r) => r.kind === 'option')).toHaveLength(0);
  });

  it('keeps pure manual events without source_option_request_id alongside options', () => {
    const optId = 'opt-pure';
    const opt = minimalOption({ id: optId });
    const item: AgencyCalendarItem = {
      option: opt,
      calendar_entry: calendarEntry({ option_request_id: optId }),
    };
    const pureManual = manualEv({
      id: 'uce-pure',
      source_option_request_id: null,
      title: 'Team offsite',
    });
    const rows = buildUnifiedAgencyCalendarRows(
      [item],
      [],
      [pureManual],
      {},
      itemByOptionId([item]),
    );
    expect(rows.filter((r) => r.kind === 'option')).toHaveLength(1);
    expect(rows.filter((r) => r.kind === 'manual')).toHaveLength(1);
  });
});

describe('filterUnifiedAgencyCalendarRows — booking tab with job_confirmed option', () => {
  it('shows one booking-category option row; pure manual excluded from booking filter', () => {
    const optId = 'opt-job';
    const opt = minimalOption({
      id: optId,
      final_status: 'job_confirmed',
      status: 'confirmed',
      client_price_status: 'accepted',
      model_approval: 'approved',
    });
    const item: AgencyCalendarItem = {
      option: opt,
      calendar_entry: calendarEntry({
        option_request_id: optId,
        entry_type: 'booking',
        status: 'booked',
        title: 'Job – Client Co',
      }),
    };
    const pureManual = manualEv({
      id: 'uce-unrelated',
      source_option_request_id: null,
      title: 'Internal meeting',
      date: '2026-04-16',
    });
    const unified = buildUnifiedAgencyCalendarRows(
      [item],
      [],
      [pureManual],
      {},
      itemByOptionId([item]),
    );
    const filtered = filterUnifiedAgencyCalendarRows(unified, {
      modelQuery: '',
      fromDate: '',
      toDate: '',
      typeFilter: 'booking',
      assigneeFilter: 'all',
      clientScope: 'all',
      urgency: 'all',
      currentUserId: null,
      assignmentByClientOrgId: {},
    });
    const deduped = dedupeUnifiedRowsByOptionRequest(filtered);
    expect(deduped.filter((r) => r.kind === 'option')).toHaveLength(1);
    expect(deduped.filter((r) => r.kind === 'manual')).toHaveLength(0);
  });
});
