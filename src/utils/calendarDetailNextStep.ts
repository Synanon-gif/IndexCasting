/**
 * One-line "next step" copy for calendar detail overlays — aligned with deriveSmartAttentionState.
 */
import type { SupabaseOptionRequest } from '../services/optionRequestsSupabase';
import type { CalendarEntry } from '../services/calendarSupabase';
import type { OptionRequest } from '../store/optionRequests';
import { deriveSmartAttentionState, type SmartAttentionState } from './optionRequestAttention';

export type CalendarDetailNextStepCopy = {
  nextStepAwaitingModel: string;
  nextStepAwaitingAgency: string;
  nextStepAwaitingClient: string;
  nextStepJobConfirm: string;
  nextStepNegotiating: string;
  nextStepNoAction: string;
  nextStepYourConfirm: string;
};

function mapAttentionToNextStepCopy(
  st: SmartAttentionState,
  role: 'client' | 'agency' | 'model',
  c: CalendarDetailNextStepCopy,
): string {
  if (st === 'waiting_for_model') {
    return role === 'model' ? c.nextStepYourConfirm : c.nextStepAwaitingModel;
  }
  if (st === 'waiting_for_agency') return c.nextStepAwaitingAgency;
  if (st === 'waiting_for_client') return c.nextStepAwaitingClient;
  if (st === 'job_confirmation_pending') return c.nextStepJobConfirm;
  if (st === 'counter_pending' || st === 'conflict_risk') return c.nextStepNegotiating;
  if (st === 'no_attention') return c.nextStepNoAction;
  return c.nextStepNegotiating;
}

export function getCalendarDetailNextStepText(
  option: SupabaseOptionRequest,
  _calendar_entry: CalendarEntry | null,
  role: 'client' | 'agency' | 'model',
  c: CalendarDetailNextStepCopy,
): string {
  const st = deriveSmartAttentionState({
    status: option.status,
    finalStatus: option.final_status,
    clientPriceStatus: option.client_price_status,
    modelApproval: option.model_approval,
    modelAccountLinked: option.model_account_linked,
    hasConflictWarning: false,
  });
  return mapAttentionToNextStepCopy(st, role, c);
}

/** Model app: local option store row (same workflow fields as Supabase). */
export function getCalendarDetailNextStepForModelLocalOption(
  opt: OptionRequest,
  c: CalendarDetailNextStepCopy,
): string {
  const st = deriveSmartAttentionState({
    status: opt.status,
    finalStatus: opt.finalStatus ?? null,
    clientPriceStatus: opt.clientPriceStatus ?? null,
    modelApproval: opt.modelApproval,
    modelAccountLinked: opt.modelAccountLinked,
    hasConflictWarning: false,
  });
  return mapAttentionToNextStepCopy(st, 'model', c);
}
