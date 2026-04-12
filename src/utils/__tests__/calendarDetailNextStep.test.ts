import { getCalendarDetailNextStepText, getCalendarDetailNextStepForModelLocalOption } from '../calendarDetailNextStep';
import type { SupabaseOptionRequest } from '../../services/optionRequestsSupabase';
import type { OptionRequest } from '../../store/optionRequests';
import {
  approvalAttentionVisibleForRole,
  negotiationAttentionVisibleForRole,
  clientMayConfirmJobFromSignals,
  modelInboxSortPriority,
  type AttentionSignalInput,
} from '../optionRequestAttention';

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

function localOption(overrides: Partial<OptionRequest> = {}): OptionRequest {
  return {
    id: 'opt-local-1',
    threadId: 'thread-1',
    date: '2026-04-15',
    clientName: 'Client',
    modelName: 'Model',
    modelId: 'm1',
    agencyId: 'a1',
    createdAt: Date.now(),
    status: 'in_negotiation',
    finalStatus: 'option_pending',
    requestType: 'option',
    modelApproval: 'pending',
    modelAccountLinked: true,
    proposedPrice: 100,
    clientPriceStatus: 'pending',
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

describe('getCalendarDetailNextStepText — hasConflictWarning', () => {
  it('conflict warning overrides all other signals → negotiating for every role', () => {
    const option = minimalOption({
      proposed_price: 5000,
      client_price_status: 'accepted',
      final_status: 'option_confirmed',
      model_approval: 'pending',
      model_account_linked: true,
    });
    expect(getCalendarDetailNextStepText(option, null, 'client', baseCopy, true)).toBe(baseCopy.nextStepNegotiating);
    expect(getCalendarDetailNextStepText(option, null, 'agency', baseCopy, true)).toBe(baseCopy.nextStepNegotiating);
    expect(getCalendarDetailNextStepText(option, null, 'model', baseCopy, true)).toBe(baseCopy.nextStepNegotiating);
  });

  it('without conflict flag same option shows model-specific next step', () => {
    const option = minimalOption({
      proposed_price: 5000,
      client_price_status: 'accepted',
      final_status: 'option_confirmed',
      model_approval: 'pending',
      model_account_linked: true,
    });
    expect(getCalendarDetailNextStepText(option, null, 'model', baseCopy, false)).toBe(baseCopy.nextStepYourConfirm);
  });
});

describe('getCalendarDetailNextStepForModelLocalOption', () => {
  it('model must confirm: shows your-turn copy', () => {
    const opt = localOption({
      clientPriceStatus: 'accepted',
      finalStatus: 'option_confirmed',
      modelApproval: 'pending',
      modelAccountLinked: true,
      proposedPrice: 100,
    });
    expect(getCalendarDetailNextStepForModelLocalOption(opt, baseCopy)).toBe(baseCopy.nextStepYourConfirm);
  });

  it('no model account + confirmed: shows no-action (auto-approved)', () => {
    const opt = localOption({
      clientPriceStatus: 'accepted',
      finalStatus: 'option_confirmed',
      modelApproval: 'approved',
      modelAccountLinked: false,
      proposedPrice: 100,
    });
    expect(getCalendarDetailNextStepForModelLocalOption(opt, baseCopy)).toBe(baseCopy.nextStepNoAction);
  });

  it('price still negotiating: model sees negotiating', () => {
    const opt = localOption({
      clientPriceStatus: 'pending',
      finalStatus: 'option_pending',
      proposedPrice: 100,
      agencyCounterPrice: undefined,
    });
    expect(getCalendarDetailNextStepForModelLocalOption(opt, baseCopy)).toBe(baseCopy.nextStepNegotiating);
  });

  it('conflict warning: model sees negotiating regardless of approval state', () => {
    const opt = localOption({
      clientPriceStatus: 'accepted',
      finalStatus: 'option_confirmed',
      modelApproval: 'pending',
      modelAccountLinked: true,
      proposedPrice: 100,
    });
    expect(getCalendarDetailNextStepForModelLocalOption(opt, baseCopy, true)).toBe(baseCopy.nextStepNegotiating);
  });

  it('rejected status: shows no-action', () => {
    const opt = localOption({
      status: 'rejected',
      finalStatus: 'option_pending',
      modelApproval: 'rejected',
    });
    expect(getCalendarDetailNextStepForModelLocalOption(opt, baseCopy)).toBe(baseCopy.nextStepNoAction);
  });

  it('job_confirmed: shows no-action', () => {
    const opt = localOption({
      status: 'confirmed',
      finalStatus: 'job_confirmed',
      modelApproval: 'approved',
      clientPriceStatus: 'accepted',
      proposedPrice: 100,
    });
    expect(getCalendarDetailNextStepForModelLocalOption(opt, baseCopy)).toBe(baseCopy.nextStepNoAction);
  });
});

describe('approvalAttentionVisibleForRole — direct tests', () => {
  it('inactive: never visible', () => {
    expect(approvalAttentionVisibleForRole('approval_inactive', 'client')).toBe(false);
    expect(approvalAttentionVisibleForRole('approval_inactive', 'agency')).toBe(false);
    expect(approvalAttentionVisibleForRole('approval_inactive', 'model')).toBe(false);
  });

  it('fully_cleared: never visible', () => {
    expect(approvalAttentionVisibleForRole('fully_cleared', 'client')).toBe(false);
    expect(approvalAttentionVisibleForRole('fully_cleared', 'agency')).toBe(false);
  });

  it('job_completed: never visible', () => {
    expect(approvalAttentionVisibleForRole('job_completed', 'client')).toBe(false);
    expect(approvalAttentionVisibleForRole('job_completed', 'agency')).toBe(false);
  });

  it('waiting_for_agency_confirmation: visible for client + agency, not model', () => {
    expect(approvalAttentionVisibleForRole('waiting_for_agency_confirmation', 'client')).toBe(true);
    expect(approvalAttentionVisibleForRole('waiting_for_agency_confirmation', 'agency')).toBe(true);
    expect(approvalAttentionVisibleForRole('waiting_for_agency_confirmation', 'model')).toBe(false);
  });

  it('waiting_for_model_confirmation: visible for client + agency, not model', () => {
    expect(approvalAttentionVisibleForRole('waiting_for_model_confirmation', 'client')).toBe(true);
    expect(approvalAttentionVisibleForRole('waiting_for_model_confirmation', 'agency')).toBe(true);
    expect(approvalAttentionVisibleForRole('waiting_for_model_confirmation', 'model')).toBe(false);
  });

  it('waiting_for_client_to_finalize_job: visible only for client', () => {
    expect(approvalAttentionVisibleForRole('waiting_for_client_to_finalize_job', 'client')).toBe(true);
    expect(approvalAttentionVisibleForRole('waiting_for_client_to_finalize_job', 'agency')).toBe(false);
    expect(approvalAttentionVisibleForRole('waiting_for_client_to_finalize_job', 'model')).toBe(false);
  });
});

describe('negotiationAttentionVisibleForRole — direct tests', () => {
  it('terminal: never visible', () => {
    expect(negotiationAttentionVisibleForRole('negotiation_terminal', 'client')).toBe(false);
    expect(negotiationAttentionVisibleForRole('negotiation_terminal', 'agency')).toBe(false);
    expect(negotiationAttentionVisibleForRole('negotiation_terminal', 'model')).toBe(false);
  });

  it('price_agreed: never visible', () => {
    expect(negotiationAttentionVisibleForRole('price_agreed', 'client')).toBe(false);
    expect(negotiationAttentionVisibleForRole('price_agreed', 'agency')).toBe(false);
  });

  it('waiting_for_client_response: visible only for client', () => {
    expect(negotiationAttentionVisibleForRole('waiting_for_client_response', 'client')).toBe(true);
    expect(negotiationAttentionVisibleForRole('waiting_for_client_response', 'agency')).toBe(false);
    expect(negotiationAttentionVisibleForRole('waiting_for_client_response', 'model')).toBe(false);
  });

  it('waiting_for_agency_response: visible for agency + client', () => {
    expect(negotiationAttentionVisibleForRole('waiting_for_agency_response', 'agency')).toBe(true);
    expect(negotiationAttentionVisibleForRole('waiting_for_agency_response', 'client')).toBe(true);
    expect(negotiationAttentionVisibleForRole('waiting_for_agency_response', 'model')).toBe(false);
  });

  it('counter_rejected: visible for agency + client', () => {
    expect(negotiationAttentionVisibleForRole('counter_rejected', 'agency')).toBe(true);
    expect(negotiationAttentionVisibleForRole('counter_rejected', 'client')).toBe(true);
  });

  it('negotiation_open: visible for agency + client', () => {
    expect(negotiationAttentionVisibleForRole('negotiation_open', 'agency')).toBe(true);
    expect(negotiationAttentionVisibleForRole('negotiation_open', 'client')).toBe(true);
    expect(negotiationAttentionVisibleForRole('negotiation_open', 'model')).toBe(false);
  });
});

describe('clientMayConfirmJobFromSignals — direct tests', () => {
  it('returns true only when both axes settled and agency confirmed', () => {
    const ready: AttentionSignalInput = {
      status: 'in_negotiation',
      finalStatus: 'option_confirmed',
      clientPriceStatus: 'accepted',
      proposedPrice: 100,
      modelApproval: 'approved',
      modelAccountLinked: true,
    };
    expect(clientMayConfirmJobFromSignals(ready)).toBe(true);
  });

  it('false when price not settled', () => {
    const input: AttentionSignalInput = {
      status: 'in_negotiation',
      finalStatus: 'option_confirmed',
      clientPriceStatus: 'pending',
      proposedPrice: 100,
      modelApproval: 'approved',
      modelAccountLinked: true,
    };
    expect(clientMayConfirmJobFromSignals(input)).toBe(false);
  });

  it('false when model has not approved', () => {
    const input: AttentionSignalInput = {
      status: 'in_negotiation',
      finalStatus: 'option_confirmed',
      clientPriceStatus: 'accepted',
      proposedPrice: 100,
      modelApproval: 'pending',
      modelAccountLinked: true,
    };
    expect(clientMayConfirmJobFromSignals(input)).toBe(false);
  });

  it('false when agency has not confirmed (option_pending)', () => {
    const input: AttentionSignalInput = {
      status: 'in_negotiation',
      finalStatus: 'option_pending',
      clientPriceStatus: 'accepted',
      proposedPrice: 100,
      modelApproval: 'approved',
      modelAccountLinked: true,
    };
    expect(clientMayConfirmJobFromSignals(input)).toBe(false);
  });

  it('true for no-model-account when price settled + agency confirmed', () => {
    const input: AttentionSignalInput = {
      status: 'in_negotiation',
      finalStatus: 'option_confirmed',
      clientPriceStatus: 'accepted',
      proposedPrice: 100,
      modelApproval: 'approved',
      modelAccountLinked: false,
    };
    expect(clientMayConfirmJobFromSignals(input)).toBe(true);
  });

  it('false after job already confirmed', () => {
    const input: AttentionSignalInput = {
      status: 'confirmed',
      finalStatus: 'job_confirmed',
      clientPriceStatus: 'accepted',
      proposedPrice: 100,
      modelApproval: 'approved',
    };
    expect(clientMayConfirmJobFromSignals(input)).toBe(false);
  });
});

describe('modelInboxSortPriority — full coverage', () => {
  it('priority 0: model must confirm', () => {
    expect(modelInboxSortPriority({
      status: 'in_negotiation',
      finalStatus: 'option_confirmed',
      modelApproval: 'pending',
      modelAccountLinked: true,
    })).toBe(0);
  });

  it('priority 1: linked model, pending but not yet at confirmation gate', () => {
    expect(modelInboxSortPriority({
      status: 'in_negotiation',
      finalStatus: 'option_pending',
      modelApproval: 'pending',
      modelAccountLinked: true,
    })).toBe(1);
  });

  it('priority 2: no model account', () => {
    expect(modelInboxSortPriority({
      status: 'in_negotiation',
      finalStatus: 'option_confirmed',
      modelApproval: 'pending',
      modelAccountLinked: false,
    })).toBe(2);
  });

  it('priority 2: model already approved', () => {
    expect(modelInboxSortPriority({
      status: 'confirmed',
      finalStatus: 'option_confirmed',
      modelApproval: 'approved',
      modelAccountLinked: true,
    })).toBe(2);
  });

  it('priority 2: rejected status', () => {
    expect(modelInboxSortPriority({
      status: 'rejected',
      finalStatus: 'option_pending',
      modelApproval: 'rejected',
      modelAccountLinked: true,
    })).toBe(2);
  });

  it('sort order: 0 < 1 < 2', () => {
    const must = modelInboxSortPriority({ status: 'in_negotiation', finalStatus: 'option_confirmed', modelApproval: 'pending', modelAccountLinked: true });
    const linked = modelInboxSortPriority({ status: 'in_negotiation', finalStatus: 'option_pending', modelApproval: 'pending', modelAccountLinked: true });
    const other = modelInboxSortPriority({ status: 'confirmed', finalStatus: 'job_confirmed', modelApproval: 'approved', modelAccountLinked: true });
    expect(must).toBeLessThan(linked);
    expect(linked).toBeLessThan(other);
  });
});
