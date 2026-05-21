import type { AgencyCalendarItem, CalendarEntry } from '../../services/calendarSupabase';
import type { SupabaseOptionRequest } from '../../services/optionRequestsSupabase';
import type { UserCalendarEvent } from '../../services/userCalendarEventsSupabase';
import {
  B2B_CALENDAR_CHIP_TITLE_SEPARATOR,
  resolveB2BCalendarChipTitle,
} from '../calendarEventDisplayTitle';
import {
  buildUnifiedAgencyCalendarRows,
  preferJobBookingOverOptionRows,
} from '../agencyCalendarUnified';
import { uiCopy } from '../../constants/uiCopy';

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
    client_name: 'Client 3',
    model_name: 'RÉMI LOVISOLO',
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
    agency_organization_id: 'Poetry of People',
    client_organization_id: 'Client 3',
    client_organization_name: 'Client 3',
    agency_organization_name: 'Poetry of People',
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
    title: 'Option – Client 3',
    entry_type: 'option',
    status: 'tentative',
    booking_id: null,
    note: null,
    created_at: now,
    option_request_id: 'opt-1',
    ...overrides,
  };
}

function itemByOptionId(items: AgencyCalendarItem[]): Map<string, AgencyCalendarItem> {
  return new Map(items.map((i) => [i.option.id, i]));
}

describe('resolveB2BCalendarChipTitle', () => {
  const sep = B2B_CALENDAR_CHIP_TITLE_SEPARATOR;

  it('client: option_pending without calendar_entry uses model + agency', () => {
    expect(
      resolveB2BCalendarChipTitle({
        viewerRole: 'client',
        modelName: 'RÉMI LOVISOLO',
        agencyOrganizationName: 'Poetry of People',
      }),
    ).toBe(`RÉMI LOVISOLO${sep}Poetry of People`);
  });

  it('client: ignores DB title when model + agency exist', () => {
    expect(
      resolveB2BCalendarChipTitle({
        viewerRole: 'client',
        modelName: 'RÉMI LOVISOLO',
        agencyOrganizationName: 'Poetry of People',
        fallbackTitle: 'Option – Client 3',
      }),
    ).toBe(`RÉMI LOVISOLO${sep}Poetry of People`);
  });

  it('client: casting uses model + agency', () => {
    expect(
      resolveB2BCalendarChipTitle({
        viewerRole: 'client',
        modelName: 'RÉMI LOVISOLO',
        agencyOrganizationName: 'Poetry of People',
        kind: 'casting',
      }),
    ).toBe(`RÉMI LOVISOLO${sep}Poetry of People`);
  });

  it('client: job kind uses model + agency', () => {
    expect(
      resolveB2BCalendarChipTitle({
        viewerRole: 'client',
        modelName: 'RÉMI LOVISOLO',
        agencyOrganizationName: 'Poetry of People',
        kind: 'booking',
        fallbackTitle: 'Client 3 – job',
      }),
    ).toBe(`RÉMI LOVISOLO${sep}Poetry of People`);
  });

  it('client: missing agency name falls back to unknownAgency', () => {
    const title = resolveB2BCalendarChipTitle({
      viewerRole: 'client',
      modelName: 'RÉMI LOVISOLO',
      agencyOrganizationName: null,
    });
    expect(title).toBe(`RÉMI LOVISOLO${sep}${uiCopy.common.unknownAgency}`);
    expect(title).not.toContain('undefined');
    expect(title).not.toContain('null');
  });

  it('agency: option_confirmed uses model + client org', () => {
    expect(
      resolveB2BCalendarChipTitle({
        viewerRole: 'agency',
        modelName: 'RÉMI LOVISOLO',
        clientOrganizationName: 'Client 3',
        fallbackTitle: 'Option – Client 3',
      }),
    ).toBe(`RÉMI LOVISOLO${sep}Client 3`);
  });

  it('agency: option_pending without calendar_entry uses model + client', () => {
    expect(
      resolveB2BCalendarChipTitle({
        viewerRole: 'agency',
        modelName: 'RÉMI LOVISOLO',
        clientOrganizationName: 'Client 3',
      }),
    ).toBe(`RÉMI LOVISOLO${sep}Client 3`);
  });

  it('agency: casting uses model + client', () => {
    expect(
      resolveB2BCalendarChipTitle({
        viewerRole: 'agency',
        modelName: 'RÉMI LOVISOLO',
        clientOrganizationName: 'Client 3',
        kind: 'casting',
      }),
    ).toBe(`RÉMI LOVISOLO${sep}Client 3`);
  });

  it('agency: job uses model + client when option data exists', () => {
    expect(
      resolveB2BCalendarChipTitle({
        viewerRole: 'agency',
        modelName: 'RÉMI LOVISOLO',
        clientOrganizationName: 'Client 3',
        kind: 'booking',
        fallbackTitle: 'Client 3 – job',
      }),
    ).toBe(`RÉMI LOVISOLO${sep}Client 3`);
  });

  it('agency-only: shows model name only', () => {
    expect(
      resolveB2BCalendarChipTitle({
        viewerRole: 'agency',
        modelName: 'RÉMI LOVISOLO',
        isAgencyOnly: true,
        fallbackTitle: 'Option – Internal Agency',
      }),
    ).toBe('RÉMI LOVISOLO');
  });

  it('agency: missing client org falls back to unknownClient', () => {
    const title = resolveB2BCalendarChipTitle({
      viewerRole: 'agency',
      modelName: 'RÉMI LOVISOLO',
    });
    expect(title).toBe(`RÉMI LOVISOLO${sep}${uiCopy.common.unknownClient}`);
    expect(title).not.toContain('undefined');
    expect(title).not.toContain('null');
  });

  it('client title does not equal own client org DB title when model+agency exist', () => {
    const title = resolveB2BCalendarChipTitle({
      viewerRole: 'client',
      modelName: 'RÉMI LOVISOLO',
      agencyOrganizationName: 'Poetry of People',
      fallbackTitle: 'Option – Client 3',
    });
    expect(title).not.toBe('Option – Client 3');
  });
});

describe('buildUnifiedAgencyCalendarRows — role-aware chip titles', () => {
  it('client option row uses model + agency (pending, no calendar_entry)', () => {
    const opt = minimalOption({ id: 'opt-pending', final_status: 'option_pending' });
    const item: AgencyCalendarItem = { option: opt, calendar_entry: null };
    const rows = buildUnifiedAgencyCalendarRows([item], [], [], {}, itemByOptionId([item]), {
      viewerRole: 'client',
    });
    expect(rows[0].kind).toBe('option');
    if (rows[0].kind !== 'option') return;
    expect(rows[0].title).toBe(`RÉMI LOVISOLO${B2B_CALENDAR_CHIP_TITLE_SEPARATOR}Poetry of People`);
  });

  it('client option row ignores calendar_entries.title when model+agency exist', () => {
    const opt = minimalOption({ id: 'opt-conf', final_status: 'option_confirmed' });
    const item: AgencyCalendarItem = {
      option: opt,
      calendar_entry: calendarEntry({ option_request_id: 'opt-conf', title: 'Option – Client 3' }),
    };
    const rows = buildUnifiedAgencyCalendarRows([item], [], [], {}, itemByOptionId([item]), {
      viewerRole: 'client',
    });
    expect(rows[0].title).toBe(`RÉMI LOVISOLO${B2B_CALENDAR_CHIP_TITLE_SEPARATOR}Poetry of People`);
  });

  it('agency option row uses model + client org', () => {
    const opt = minimalOption({ id: 'opt-ag', final_status: 'option_confirmed' });
    const item: AgencyCalendarItem = {
      option: opt,
      calendar_entry: calendarEntry({ option_request_id: 'opt-ag' }),
    };
    const rows = buildUnifiedAgencyCalendarRows([item], [], [], {}, itemByOptionId([item]), {
      viewerRole: 'agency',
    });
    expect(rows[0].title).toBe(`RÉMI LOVISOLO${B2B_CALENDAR_CHIP_TITLE_SEPARATOR}Client 3`);
  });

  it('manual/private user_calendar_events title unchanged', () => {
    const pureManual: UserCalendarEvent = {
      id: 'uce-pure',
      owner_id: 'u1',
      owner_type: 'client',
      date: '2026-04-15',
      start_time: null,
      end_time: null,
      title: 'Team offsite',
      color: '#888',
      note: null,
      organization_id: null,
      created_by: null,
      source_option_request_id: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const rows = buildUnifiedAgencyCalendarRows([], [], [pureManual], {}, new Map(), {
      viewerRole: 'client',
    });
    expect(rows.filter((r) => r.kind === 'manual')[0]?.title).toBe('Team offsite');
  });

  it('job booking row uses role-aware title when linked option exists', () => {
    const optId = 'opt-job';
    const opt = minimalOption({
      id: optId,
      final_status: 'job_confirmed',
      status: 'confirmed',
      request_type: 'option',
    });
    const item: AgencyCalendarItem = {
      option: opt,
      calendar_entry: calendarEntry({
        option_request_id: optId,
        entry_type: 'booking',
        title: 'Job – Client 3',
      }),
    };
    const beEntry: CalendarEntry = {
      id: 'be:be-1',
      model_id: 'm1',
      date: '2026-04-15',
      start_time: null,
      end_time: null,
      title: 'Client 3 – job',
      entry_type: 'booking',
      status: 'booked',
      booking_id: null,
      note: null,
      created_at: new Date().toISOString(),
      option_request_id: optId,
    };
    const rows = preferJobBookingOverOptionRows(
      buildUnifiedAgencyCalendarRows([item], [beEntry], [], {}, itemByOptionId([item]), {
        viewerRole: 'client',
      }),
    );
    const booking = rows.find((r) => r.kind === 'booking');
    expect(booking?.title).toBe(
      `RÉMI LOVISOLO${B2B_CALENDAR_CHIP_TITLE_SEPARATOR}Poetry of People`,
    );
  });

  it('without viewerRole keeps legacy DB title on option rows', () => {
    const opt = minimalOption({ id: 'opt-legacy' });
    const item: AgencyCalendarItem = {
      option: opt,
      calendar_entry: calendarEntry({
        option_request_id: 'opt-legacy',
        title: 'Option – Client 3',
      }),
    };
    const rows = buildUnifiedAgencyCalendarRows([item], [], [], {}, itemByOptionId([item]));
    expect(rows[0].title).toBe('Option – Client 3');
  });
});
