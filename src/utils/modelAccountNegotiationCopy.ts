/**
 * Agency-facing negotiation summary hints — model-account vs no-account.
 * Backend: agency confirms availability first (final_status = option_confirmed), then linked model may confirm.
 * Must not imply the model acts before the agency when final_status is still pending.
 */
import { uiCopy } from '../constants/uiCopy';

export type AgencyNegotiationSummaryInput = {
  modelAccountLinked: boolean | null | undefined;
  modelApproval: string | undefined;
  finalStatus: string | null | undefined;
  status: string | undefined;
};

/** Short line under negotiation header (agency Messages / desktop rail). */
export function agencyNegotiationThreadSummaryHint(input: AgencyNegotiationSummaryInput): string | null {
  if (input.modelAccountLinked === false) {
    return uiCopy.optionNegotiationChat.noModelAppNegotiationHint;
  }
  if (input.modelApproval === 'approved') {
    return uiCopy.optionNegotiationChat.modelAvailabilityConfirmedHint;
  }
  if (
    input.finalStatus === 'option_confirmed' &&
    input.status === 'in_negotiation' &&
    input.modelApproval === 'pending'
  ) {
    return uiCopy.optionNegotiationChat.agencyWaitingForModelAfterAvailability;
  }
  if (
    input.modelApproval === 'pending' &&
    input.finalStatus !== 'option_confirmed' &&
    input.finalStatus !== 'job_confirmed'
  ) {
    return uiCopy.optionNegotiationChat.agencyConfirmAvailabilityBeforeModelStep;
  }
  return null;
}

/** Thread lifecycle banner when final_status is option_confirmed but model still pending (linked model). */
export function optionConfirmedBannerLabel(input: {
  finalStatus: string | null | undefined;
  modelAccountLinked: boolean | null | undefined;
  modelApproval: string | undefined;
}): string {
  if (input.finalStatus === 'job_confirmed') {
    return uiCopy.dashboard.optionRequestStatusJobConfirmed;
  }
  if (input.finalStatus === 'option_confirmed') {
    if (
      input.modelAccountLinked === true &&
      input.modelApproval === 'pending'
    ) {
      return uiCopy.dashboard.optionRequestStatusAvailabilityConfirmedAwaitingModel;
    }
    return uiCopy.dashboard.optionRequestStatusConfirmed;
  }
  return uiCopy.dashboard.optionRequestStatusPending;
}
