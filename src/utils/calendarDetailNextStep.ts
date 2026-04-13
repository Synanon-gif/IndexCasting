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

  // Model must confirm option — calendar should still show the model-facing line.
  if (role === 'model' && appr === 'waiting_for_model_confirmation') {
    return c.nextStepYourConfirm;
  }

  // ─── Action-priority: this role must act (D2 action > D1 action) ───
  if (appr === 'waiting_for_agency_confirmation' && role === 'agency') return c.nextStepNegotiating;
  if (appr === 'waiting_for_client_to_finalize_job' && role === 'client')
    return c.nextStepJobConfirm;
  if (appr === 'waiting_for_agency_to_finalize_job' && role === 'agency')
    return c.nextStepJobConfirm;

  const agencyMustActOnPrice =
    neg === 'waiting_for_agency_response' ||
    neg === 'negotiation_open' ||
    neg === 'counter_rejected';
  if (role === 'agency' && agencyMustActOnPrice) return c.nextStepNegotiating;
  if (role === 'client' && neg === 'waiting_for_client_response') return c.nextStepNegotiating;

  // ─── Waiting: someone else must act (D2 waiting > D1 waiting) ───
  if (approvalAttentionVisibleForRole(appr, role)) {
    if (appr === 'waiting_for_agency_confirmation') return c.nextStepAwaitingAgency;
    if (appr === 'waiting_for_model_confirmation') return c.nextStepAwaitingModel;
    if (appr === 'waiting_for_client_to_finalize_job') return c.nextStepJobConfirm;
    if (appr === 'waiting_for_agency_to_finalize_job') return c.nextStepJobConfirm;
    return c.nextStepNegotiating;
  }

  if (neg === 'negotiation_terminal' || neg === 'price_agreed') return c.nextStepNoAction;

  if (neg === 'waiting_for_client_response') {
    return role === 'agency' ? c.nextStepAwaitingClient : c.nextStepNegotiating;
  }
  if (
    neg === 'waiting_for_agency_response' ||
    neg === 'negotiation_open' ||
    neg === 'counter_rejected'
  ) {
    return role === 'client' ? c.nextStepAwaitingAgency : c.nextStepNegotiating;
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
    isAgencyOnly: option.is_agency_only ?? false,
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
    isAgencyOnly: opt.isAgencyOnly ?? false,
  });
  return nextStepFromSignals(sig, 'model', c);
}
