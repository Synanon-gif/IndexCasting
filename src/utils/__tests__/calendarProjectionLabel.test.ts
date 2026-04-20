import {
  getCalendarProjectionBadge,
  getBookingEntryProjectionBadge,
  dedupeCalendarGridEventsByOptionRequest,
  calendarGridColorForOptionItem,
} from '../calendarProjectionLabel';
import type { SupabaseOptionRequest } from '../../services/optionRequestsSupabase';
import type { CalendarEntry } from '../../services/calendarSupabase';

const L = {
  rejected: 'Rejected',
  job: 'Job',
  jobTentative: 'Job (tentative)',
  casting: 'Casting',
  optionConfirmed: 'Option (confirmed)',
  optionNegotiating: 'Option (negotiating)',
  pricePending: 'Price (pending)',
  priceAgreed: 'Price agreed',
  optionPending: 'Option (pending)',
  awaitingModel: 'Awaiting model',
  awaitingClientJob: 'Job (client confirm)',
  yourConfirmationNeeded: 'Your confirmation needed',
};

function baseOption(over: Partial<SupabaseOptionRequest> = {}): SupabaseOptionRequest {
  return {
    id: 'o1',
    client_id: 'c1',
    model_id: 'm1',
    agency_id: 'a1',
    requested_date: '2026-04-10',
    status: 'in_negotiation',
    project_id: null,
    client_name: null,
    model_name: 'M',
    job_description: null,
    proposed_price: null,
    agency_counter_price: null,
    client_price_status: null,
    final_status: null,
    request_type: 'option',
    currency: 'EUR',
    start_time: null,
    end_time: null,
    model_approval: 'pending',
    model_approved_at: null,
    model_account_linked: true,
    booker_id: null,
    organization_id: null,
    agency_organization_id: null,
    client_organization_id: null,
    client_organization_name: null,
    agency_organization_name: null,
    created_by: null,
    agency_assignee_user_id: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...over,
  };
}

function entry(over: Partial<CalendarEntry> = {}): CalendarEntry {
  return {
    id: 'ce1',
    model_id: 'm1',
    date: '2026-04-10',
    start_time: null,
    end_time: null,
    title: null,
    entry_type: 'option',
    status: 'available',
    booking_id: null,
    note: null,
    created_at: new Date().toISOString(),
    option_request_id: 'o1',
    ...over,
  };
}

describe('calendarProjectionLabel', () => {
  it('maps rejected option_requests.status', () => {
    const b = getCalendarProjectionBadge(baseOption({ status: 'rejected' }), null, L);
    expect(b.label).toBe(L.rejected);
  });

  it('maps job_confirmed to Job label', () => {
    const b = getCalendarProjectionBadge(baseOption({ final_status: 'job_confirmed' }), null, L);
    expect(b.label).toBe(L.job);
  });

  it('maps calendar entry_type booking with tentative status', () => {
    const b = getCalendarProjectionBadge(
      baseOption({ status: 'confirmed', final_status: 'option_confirmed' }),
      entry({ entry_type: 'booking', status: 'tentative' }),
      L,
    );
    expect(b.label).toBe(L.jobTentative);
  });

  it('maps casting entry_type', () => {
    const b = getCalendarProjectionBadge(baseOption(), entry({ entry_type: 'casting' }), L);
    expect(b.label).toBe(L.casting);
  });

  it('maps request_type casting when not a job', () => {
    const b = getCalendarProjectionBadge(baseOption({ request_type: 'casting' }), null, L);
    expect(b.label).toBe(L.casting);
  });

  it('maps option_confirmed + approvals done to client job step (approval badge)', () => {
    const b = getCalendarProjectionBadge(
      baseOption({
        final_status: 'option_confirmed',
        status: 'confirmed',
        client_price_status: 'accepted',
        model_approval: 'approved',
        model_account_linked: true,
        proposed_price: 5000,
      }),
      entry({ entry_type: 'option' }),
      L,
    );
    expect(b.label).toBe(L.awaitingClientJob);
  });

  it('maps linked model pending to awaiting model (client view)', () => {
    const b = getCalendarProjectionBadge(
      baseOption({
        status: 'in_negotiation',
        final_status: 'option_confirmed',
        client_price_status: 'accepted',
        model_approval: 'pending',
        model_account_linked: true,
        proposed_price: 5000,
      }),
      entry({ entry_type: 'option' }),
      L,
      'client',
    );
    expect(b.label).toBe(L.awaitingModel);
  });

  it('maps linked model pending to your confirmation needed (model view)', () => {
    const b = getCalendarProjectionBadge(
      baseOption({
        status: 'in_negotiation',
        final_status: 'option_confirmed',
        client_price_status: 'accepted',
        model_approval: 'pending',
        model_account_linked: true,
        proposed_price: 5000,
      }),
      entry({ entry_type: 'option' }),
      L,
      'model',
    );
    expect(b.label).toBe(L.yourConfirmationNeeded);
  });

  it('maps client_price_status pending to negotiating (not raw price-pending badge)', () => {
    const b = getCalendarProjectionBadge(
      baseOption({ client_price_status: 'pending', proposed_price: 100 }),
      null,
      L,
    );
    expect(b.label).toBe(L.optionNegotiating);
  });

  it('maps price agreed + model pending to awaiting model (approval phase)', () => {
    const b = getCalendarProjectionBadge(
      baseOption({
        client_price_status: 'accepted',
        final_status: 'option_confirmed',
        status: 'in_negotiation',
        model_approval: 'pending',
        model_account_linked: true,
        proposed_price: 500,
      }),
      null,
      L,
    );
    expect(b.label).toBe(L.awaitingModel);
  });

  it('getBookingEntryProjectionBadge handles orphan booking row', () => {
    const b = getBookingEntryProjectionBadge({ entry_type: 'booking', status: 'booked' }, L);
    expect(b.label).toBe(L.job);
  });

  describe('color parity — month grid === week/day badge', () => {
    type Case = {
      name: string;
      option: SupabaseOptionRequest;
      entry: CalendarEntry | null;
    };
    const cases: Case[] = [
      {
        name: 'rejected',
        option: baseOption({ status: 'rejected' }),
        entry: null,
      },
      {
        name: 'job_confirmed (no entry)',
        option: baseOption({ final_status: 'job_confirmed' }),
        entry: null,
      },
      {
        name: 'job booking tentative',
        option: baseOption({ status: 'confirmed', final_status: 'option_confirmed' }),
        entry: entry({ entry_type: 'booking', status: 'tentative' }),
      },
      {
        name: 'job booking confirmed',
        option: baseOption({ status: 'confirmed', final_status: 'job_confirmed' }),
        entry: entry({ entry_type: 'booking', status: 'booked' }),
      },
      {
        name: 'casting entry',
        option: baseOption(),
        entry: entry({ entry_type: 'casting' }),
      },
      {
        name: 'request_type casting (no entry)',
        option: baseOption({ request_type: 'casting' }),
        entry: null,
      },
      {
        name: 'option_pending default',
        option: baseOption({ status: 'in_negotiation', final_status: 'option_pending' }),
        entry: entry({ entry_type: 'option' }),
      },
      {
        name: 'awaiting agency confirmation',
        option: baseOption({
          status: 'in_negotiation',
          final_status: 'option_pending',
          client_price_status: 'accepted',
          model_approval: 'pending',
          model_account_linked: true,
          proposed_price: 500,
        }),
        entry: entry({ entry_type: 'option' }),
      },
      {
        name: 'awaiting model confirmation',
        option: baseOption({
          status: 'in_negotiation',
          final_status: 'option_confirmed',
          client_price_status: 'accepted',
          model_approval: 'pending',
          model_account_linked: true,
          proposed_price: 500,
        }),
        entry: entry({ entry_type: 'option' }),
      },
      {
        name: 'awaiting client to finalize job',
        option: baseOption({
          status: 'confirmed',
          final_status: 'option_confirmed',
          client_price_status: 'accepted',
          model_approval: 'approved',
          model_account_linked: true,
          proposed_price: 5000,
        }),
        entry: entry({ entry_type: 'option' }),
      },
      {
        name: 'agency-only awaiting agency to finalize job',
        option: baseOption({
          status: 'in_negotiation',
          final_status: 'option_confirmed',
          model_approval: 'approved',
          model_account_linked: false,
          is_agency_only: true,
        }),
        entry: entry({ entry_type: 'option' }),
      },
      {
        name: 'option confirmed (no model account, fully cleared)',
        option: baseOption({
          status: 'confirmed',
          final_status: 'option_confirmed',
          client_price_status: 'accepted',
          model_approval: 'approved',
          model_account_linked: false,
          proposed_price: 1000,
        }),
        entry: entry({ entry_type: 'option' }),
      },
      {
        name: 'in_negotiation with no signals (default option orange)',
        option: baseOption({ status: 'in_negotiation' }),
        entry: null,
      },
    ];

    cases.forEach(({ name, option, entry: ce }) => {
      it(`color matches week/day for: ${name}`, () => {
        const monthColor = calendarGridColorForOptionItem({ option, calendar_entry: ce });
        const weekDayColor = getCalendarProjectionBadge(option, ce, L).backgroundColor;
        expect(monthColor).toBe(weekDayColor);
      });

      it(`color matches week/day for: ${name} (model viewer)`, () => {
        // Month grid has no viewer concept — must still equal default (client) projection,
        // because color buckets do not depend on viewerRole (only labels do).
        const monthColor = calendarGridColorForOptionItem({ option, calendar_entry: ce });
        const modelColor = getCalendarProjectionBadge(option, ce, L, 'model').backgroundColor;
        expect(monthColor).toBe(modelColor);
      });

      it(`color matches week/day for: ${name} (agency viewer)`, () => {
        const monthColor = calendarGridColorForOptionItem({ option, calendar_entry: ce });
        const agencyColor = getCalendarProjectionBadge(option, ce, L, 'agency').backgroundColor;
        expect(monthColor).toBe(agencyColor);
      });
    });
  });

  it('dedupeCalendarGridEventsByOptionRequest collapses same option_request on same day', () => {
    const d = dedupeCalendarGridEventsByOptionRequest({
      '2026-04-10': [
        { id: 'a', color: '#111', title: 'First', optionRequestId: 'same-opt' },
        { id: 'b', color: '#222', title: 'Dup', optionRequestId: 'same-opt' },
        { id: 'm', color: '#999', title: 'Manual' },
      ],
    });
    expect(d['2026-04-10']).toHaveLength(2);
    expect(d['2026-04-10']?.[0]?.title).toBe('First');
  });
});
