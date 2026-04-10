import { getCalendarDetailNextStepText } from '../calendarDetailNextStep';
import type { SupabaseOptionRequest } from '../../services/optionRequestsSupabase';

const baseCopy = {
  nextStepAwaitingModel: 'Await model',
  nextStepAwaitingAgency: 'Await agency',
  nextStepAwaitingClient: 'Await client org',
  nextStepJobConfirm: 'Confirm job',
  nextStepNegotiating: 'Negotiating',
  nextStepNoAction: 'None',
  nextStepYourConfirm: 'Your turn',
};

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

describe('getCalendarDetailNextStepText — signal parity (counter + proposed)', () => {
  it('agency counter pending: client sees awaiting-agency copy, not awaiting-agency for client as wrong actor', () => {
    const option = minimalOption({
      proposed_price: 5000,
      agency_counter_price: 4500,
      client_price_status: 'pending',
      final_status: 'option_pending',
      status: 'in_negotiation',
    });
    const clientLine = getCalendarDetailNextStepText(option, null, 'client', baseCopy);
    expect(clientLine).toBe(baseCopy.nextStepNegotiating);

    const agencyLine = getCalendarDetailNextStepText(option, null, 'agency', baseCopy);
    expect(agencyLine).toBe(baseCopy.nextStepAwaitingClient);
  });

  it('client proposed fee, no counter yet: agency sees negotiating / action, client awaits agency', () => {
    const option = minimalOption({
      proposed_price: 5000,
      agency_counter_price: null,
      client_price_status: 'pending',
      final_status: 'option_pending',
    });
    expect(getCalendarDetailNextStepText(option, null, 'agency', baseCopy)).toBe(baseCopy.nextStepNegotiating);
    expect(getCalendarDetailNextStepText(option, null, 'client', baseCopy)).toBe(baseCopy.nextStepAwaitingAgency);
  });

  it('counter_rejected: agency sees action line, client sees awaiting agency, model sees negotiating', () => {
    const option = minimalOption({
      proposed_price: 5000,
      agency_counter_price: 4500,
      client_price_status: 'rejected',
      final_status: 'option_pending',
      status: 'in_negotiation',
    });
    expect(getCalendarDetailNextStepText(option, null, 'agency', baseCopy)).toBe(baseCopy.nextStepNegotiating);
    expect(getCalendarDetailNextStepText(option, null, 'client', baseCopy)).toBe(baseCopy.nextStepAwaitingAgency);
    expect(getCalendarDetailNextStepText(option, null, 'model', baseCopy)).toBe(baseCopy.nextStepNegotiating);
  });

  it('commercially settled + model pending: next-step matches approval (await model for client/agency)', () => {
    const option = minimalOption({
      proposed_price: 5000,
      client_price_status: 'accepted',
      final_status: 'option_confirmed',
      status: 'in_negotiation',
      model_approval: 'pending',
      model_account_linked: true,
    });
    expect(getCalendarDetailNextStepText(option, null, 'client', baseCopy)).toBe(baseCopy.nextStepAwaitingModel);
    expect(getCalendarDetailNextStepText(option, null, 'agency', baseCopy)).toBe(baseCopy.nextStepAwaitingModel);
    expect(getCalendarDetailNextStepText(option, null, 'model', baseCopy)).toBe(baseCopy.nextStepYourConfirm);
  });

  it('job_confirmed: all roles see no-action next step', () => {
    const option = minimalOption({
      proposed_price: 100,
      client_price_status: 'accepted',
      final_status: 'job_confirmed',
      status: 'confirmed',
      model_approval: 'approved',
    });
    expect(getCalendarDetailNextStepText(option, null, 'client', baseCopy)).toBe(baseCopy.nextStepNoAction);
    expect(getCalendarDetailNextStepText(option, null, 'agency', baseCopy)).toBe(baseCopy.nextStepNoAction);
    expect(getCalendarDetailNextStepText(option, null, 'model', baseCopy)).toBe(baseCopy.nextStepNoAction);
  });
});
