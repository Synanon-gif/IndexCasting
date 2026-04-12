/**
 * One-line "next step" copy for calendar detail overlays — same priority as
 * attentionHeaderLabelFromSignals: approval (D2) first, then negotiation (D1).
 */
import type { SupabaseOptionRequest } from '../services/optionRequestsSupabase';
import type { CalendarEntry } from '../services/calendarSupabase';
import type { OptionRequest } from '../store/optionRequests';
import {
  attentionSignalsFromOptionRequestLike,
  approvalAttentionVisibleForRole,
  deriveApprovalAttention,
  deriveNegotiationAttention,
  type AttentionSignalInput,
} from './optionRequestAttention';

export type CalendarDetailNextStepCopy = {
  nextStepAwaitingModel: string;
  nextStepAwaitingAgency: string;
  nextStepAwaitingClient: string;
  nextStepJobConfirm: string;
  nextStepNegotiating: string;
  nextStepNoAction: string;
  nextStepYourConfirm: string;
};

function nextStepFromSignals(
  sig: AttentionSignalInput,
  role: 'client' | 'agency' | 'model',
  c: CalendarDetailNextStepCopy,
): string {
  if (sig.hasConflictWarning) {
    return c.nextStepNegotiating;
  }

  const appr = deriveApprovalAttention(sig);
  const neg = deriveNegotiationAttention(sig);

  // Model must confirm option — calendar should still show the model-facing line (chip hides for model).
  if (role === 'model' && appr === 'waiting_for_model_confirmation') {
    return c.nextStepYourConfirm;
  }

  if (approvalAttentionVisibleForRole(appr, role)) {
    if (appr === 'waiting_for_agency_confirmation') {
      if (role === 'agency') return c.nextStepNegotiating;
      return c.nextStepAwaitingAgency;
    }
    if (appr === 'waiting_for_model_confirmation') {
      return c.nextStepAwaitingModel;
    }
    if (appr === 'waiting_for_client_to_finalize_job') {
      return c.nextStepJobConfirm;
    }
    return c.nextStepNegotiating;
  }

  if (neg === 'negotiation_terminal') {
    return c.nextStepNoAction;
  }

  // price_agreed: no D1 action; D2 already handled above if active.
  if (neg === 'price_agreed') {
    return c.nextStepNoAction;
  }

  // Mirror negotiationAttentionLabels switch (client/agency wait semantics).
  if (neg === 'waiting_for_client_response') {
    if (role === 'client') return c.nextStepNegotiating;
    if (role === 'agency') return c.nextStepAwaitingClient;
    return c.nextStepNegotiating;
  }
  if (neg === 'waiting_for_agency_response' || neg === 'negotiation_open') {
    if (role === 'agency') return c.nextStepNegotiating;
    if (role === 'client') return c.nextStepAwaitingAgency;
    return c.nextStepNegotiating;
  }
  if (neg === 'counter_rejected') {
    if (role === 'agency') return c.nextStepNegotiating;
    if (role === 'client') return c.nextStepAwaitingAgency;
    return c.nextStepNegotiating;
  }

  return c.nextStepNoAction;
}

export function getCalendarDetailNextStepText(
  option: SupabaseOptionRequest,
  _calendar_entry: CalendarEntry | null,
  role: 'client' | 'agency' | 'model',
  c: CalendarDetailNextStepCopy,
  hasConflictWarning = false,
): string {
  const sig = attentionSignalsFromOptionRequestLike({
    status: option.status,
    finalStatus: option.final_status,
    clientPriceStatus: option.client_price_status,
    modelApproval: option.model_approval,
    modelAccountLinked: option.model_account_linked,
    agencyCounterPrice: option.agency_counter_price,
    proposedPrice: option.proposed_price,
    hasConflictWarning,
  });
  return nextStepFromSignals(sig, role, c);
}

/** Model app: local option store row (same workflow fields as Supabase). */
export function getCalendarDetailNextStepForModelLocalOption(
  opt: OptionRequest,
  c: CalendarDetailNextStepCopy,
  hasConflictWarning = false,
): string {
  const sig = attentionSignalsFromOptionRequestLike({
    status: opt.status,
    finalStatus: opt.finalStatus ?? null,
    clientPriceStatus: opt.clientPriceStatus ?? null,
    modelApproval: opt.modelApproval,
    modelAccountLinked: opt.modelAccountLinked,
    agencyCounterPrice: opt.agencyCounterPrice ?? null,
    proposedPrice: opt.proposedPrice ?? null,
    hasConflictWarning,
  });
  return nextStepFromSignals(sig, 'model', c);
}
