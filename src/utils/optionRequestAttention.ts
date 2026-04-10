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
 *
 * Order matters: `toDisplayStatus` maps `final_status === 'option_confirmed'` to "Confirmed"
 * even while `status` is still `in_negotiation` (agency accepted, model not yet). Those rows
 * must still surface `waiting_for_model` for client/agency attention — so the explicit
 * post-agency / pre-model-confirm branch runs before the displayStatus shortcut.
 */
export function deriveSmartAttentionState(input: AttentionSignalInput): SmartAttentionState {
  const finalStatus = input.finalStatus ?? null;
  const displayStatus = toDisplayStatus(input.status, finalStatus);
  const modelApproval = input.modelApproval ?? null;
  const clientPriceStatus = input.clientPriceStatus ?? null;
  const modelAccountLinked = input.modelAccountLinked !== false;

  if (finalStatus === 'job_confirmed') {
    return 'no_attention';
  }

  if (input.hasConflictWarning) {
    return 'conflict_risk';
  }

  // Agency accepted price; linked model must confirm (`modelConfirmOptionRequest` gate).
  if (
    modelAccountLinked &&
    modelApproval === 'pending' &&
    finalStatus === 'option_confirmed' &&
    input.status === 'in_negotiation'
  ) {
    return 'waiting_for_model';
  }

  // Option leg complete; client must confirm job promotion (`clientConfirmJobOnSupabase`).
  if (finalStatus === 'option_confirmed' && input.status === 'confirmed') {
    return 'job_confirmation_pending';
  }

  if (displayStatus === 'Confirmed' || displayStatus === 'Rejected') {
    return 'no_attention';
  }

  if (clientPriceStatus === 'rejected') {
    return 'counter_pending';
  }

  if (clientPriceStatus === 'pending') {
    return 'waiting_for_agency';
  }

  if (modelAccountLinked && modelApproval === 'pending') {
    return 'waiting_for_model';
  }

  return 'waiting_for_client';
}

/**
 * Model app inbox: true when this linked model must confirm/reject (same gate as
 * `modelConfirmOptionRequest` — agency already accepted, row still `in_negotiation`).
 * Not derived from `smartAttentionVisibleForRole` (that flag is for client/agency “who waits”).
 */
export function modelInboxRequiresModelConfirmation(input: {
  status: string;
  finalStatus?: string | null;
  modelApproval?: string | null;
  modelAccountLinked?: boolean | null;
}): boolean {
  if (input.modelAccountLinked === false || input.modelAccountLinked === null) return false;
  if (input.modelApproval !== 'pending') return false;
  if (input.finalStatus !== 'option_confirmed') return false;
  if (input.status !== 'in_negotiation') return false;
  return true;
}

/** Sort tier: 0 = model must act, 1 = linked model waiting on client/agency negotiation, 2 = other. */
export function modelInboxSortPriority(input: {
  status: string;
  finalStatus?: string | null;
  modelApproval?: string | null;
  modelAccountLinked?: boolean | null;
}): number {
  if (modelInboxRequiresModelConfirmation(input)) return 0;
  const modelAccountLinked = input.modelAccountLinked !== false;
  if (modelAccountLinked && input.modelApproval === 'pending') return 1;
  return 2;
}

export function smartAttentionVisibleForRole(state: SmartAttentionState, role: SmartAttentionRole): boolean {
  if (state === 'no_attention') return false;
  if (state === 'job_confirmation_pending') return role === 'client';
  if (state === 'waiting_for_model') return role !== 'model';
  if (state === 'waiting_for_agency' || state === 'counter_pending' || state === 'conflict_risk') return role === 'agency';
  if (state === 'waiting_for_client') return role === 'client';
  return true;
}
