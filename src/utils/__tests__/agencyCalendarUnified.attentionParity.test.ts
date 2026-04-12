import type { AgencyCalendarItem } from '../../services/calendarSupabase';
import type { SupabaseOptionRequest } from '../../services/optionRequestsSupabase';
import {
  buildUnifiedAgencyCalendarRows,
  needsAgencyActionForOption,
} from '../agencyCalendarUnified';
import { attentionSignalsFromOptionRequestLike } from '../optionRequestAttention';
import { attentionHeaderLabelFromSignals } from '../negotiationAttentionLabels';

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
    client_name: 'Client',
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
    created_by: null,
    agency_assignee_user_id: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

function calendarItem(overrides: Partial<SupabaseOptionRequest>): AgencyCalendarItem {
  return {
    option: minimalOption(overrides),
    calendar_entry: null,
  };
}

describe('needsAgencyActionForOption — parity with attentionHeaderLabelFromSignals (agency)', () => {
  it('matches header attention gate for sample workflow rows', () => {
    const cases: Partial<SupabaseOptionRequest>[] = [
      { client_price_status: 'pending', final_status: 'option_pending', status: 'in_negotiation' },
      {
        client_price_status: 'accepted',
        final_status: 'option_confirmed',
        status: 'in_negotiation',
        model_approval: 'pending',
      },
      {
        client_price_status: 'rejected',
        final_status: 'option_pending',
        status: 'in_negotiation',
        model_approval: 'approved',
      },
      { client_price_status: 'accepted', final_status: 'option_confirmed', status: 'confirmed', model_approval: 'approved' },
    ];
    for (const c of cases) {
      const item = calendarItem(c);
      const opt = item.option;
      const sig = attentionSignalsFromOptionRequestLike({
        status: opt.status,
        finalStatus: opt.final_status,
        clientPriceStatus: opt.client_price_status,
        modelApproval: opt.model_approval,
        modelAccountLinked: opt.model_account_linked,
        agencyCounterPrice: opt.agency_counter_price,
        proposedPrice: opt.proposed_price,
        hasConflictWarning: false,
      });
      const expected = attentionHeaderLabelFromSignals(sig, 'agency') !== null;
      expect(needsAgencyActionForOption(item)).toBe(expected);
    }
  });
});

describe('buildUnifiedAgencyCalendarRows — option row needsAgencyAction', () => {
  it('sets needsAgencyAction from needsAgencyActionForOption', () => {
    const item = calendarItem({
      client_price_status: 'pending',
      final_status: 'option_pending',
    });
    const rows = buildUnifiedAgencyCalendarRows([item], [], [], {}, new Map([[item.option.id, item]]));
    const optRow = rows.find((r) => r.kind === 'option');
    expect(optRow).toBeDefined();
    expect(optRow?.kind === 'option' && optRow.needsAgencyAction).toBe(
      needsAgencyActionForOption(item),
    );
  });
});
