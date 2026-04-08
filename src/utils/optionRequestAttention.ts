import { toDisplayStatus } from './statusHelpers';

export type SmartAttentionState =
  | 'no_attention'
  | 'waiting_for_client'
  | 'waiting_for_agency'
  | 'waiting_for_model'
  | 'counter_pending'
  | 'conflict_risk'
  | 'job_confirmation_pending';

export type SmartAttentionRole = 'agency' | 'client' | 'model';

type AttentionSignalInput = {
  status: string;
  finalStatus?: string | null;
  clientPriceStatus?: 'pending' | 'accepted' | 'rejected' | null;
  modelApproval?: 'pending' | 'approved' | 'rejected' | null;
  modelAccountLinked?: boolean | null;
  hasConflictWarning?: boolean;
};

/**
 * Whether an option/casting request should contribute to the client web Messages tab
 * attention indicator (dot). Uses the same non-terminal semantics as {@link toDisplayStatus}
 * — not read receipts and not “last message from agency”.
 */
export function optionRequestNeedsMessagesTabAttention(r: {
  status: string;
  finalStatus?: string | null;
}): boolean {
  const d = toDisplayStatus(r.status, r.finalStatus ?? null);
  return d === 'In negotiation' || d === 'Draft';
}

/**
 * Canonical action-required state for option/casting requests.
 * This derives only from stable workflow fields and never from unread/read receipts.
 */
export function deriveSmartAttentionState(input: AttentionSignalInput): SmartAttentionState {
  const finalStatus = input.finalStatus ?? null;
  const displayStatus = toDisplayStatus(input.status, finalStatus);
  const modelApproval = input.modelApproval ?? null;
  const clientPriceStatus = input.clientPriceStatus ?? null;
  const modelAccountLinked = input.modelAccountLinked !== false;

  if (finalStatus === 'option_confirmed') {
    return 'job_confirmation_pending';
  }

  if (displayStatus === 'Confirmed' || displayStatus === 'Rejected') {
    return 'no_attention';
  }

  if (input.hasConflictWarning) {
    return 'conflict_risk';
  }

  if (modelAccountLinked && modelApproval === 'pending') {
    return 'waiting_for_model';
  }

  if (clientPriceStatus === 'rejected') {
    return 'counter_pending';
  }

  if (clientPriceStatus === 'pending') {
    return 'waiting_for_agency';
  }

  return 'waiting_for_client';
}

export function smartAttentionVisibleForRole(state: SmartAttentionState, role: SmartAttentionRole): boolean {
  if (state === 'no_attention') return false;
  if (state === 'job_confirmation_pending') return role === 'client';
  if (state === 'waiting_for_model') return role !== 'model';
  if (state === 'waiting_for_agency' || state === 'counter_pending' || state === 'conflict_risk') return role === 'agency';
  if (state === 'waiting_for_client') return role === 'client';
  return true;
}
