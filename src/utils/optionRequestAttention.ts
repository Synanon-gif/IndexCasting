import { toDisplayStatus } from './statusHelpers';

/** @deprecated Prefer deriveNegotiationAttention + deriveApprovalAttention */
export type SmartAttentionState =
  | 'no_attention'
  | 'waiting_for_client'
  | 'waiting_for_agency'
  | 'waiting_for_model'
  | 'counter_pending'
  | 'conflict_risk'
  | 'job_confirmation_pending';

export type SmartAttentionRole = 'agency' | 'client' | 'model';

/**
 * Dimension 1 — price / counter (who acts in negotiation). Never mix with approval labels.
 */
export type NegotiationAttentionState =
  | 'negotiation_terminal'
  | 'waiting_for_client_response'
  | 'waiting_for_agency_response'
  | 'counter_rejected'
  | 'price_agreed'
  | 'negotiation_open';

/**
 * Dimension 2 — approvals / option→job. Only meaningful once price is agreed (`client_price_status === 'accepted'`).
 */
export type ApprovalAttentionState =
  | 'approval_inactive'
  | 'waiting_for_model_confirmation'
  | 'waiting_for_client_to_finalize_job'
  | 'fully_cleared'
  | 'job_completed';

export type AttentionSignalInput = {
  status: string;
  finalStatus?: string | null;
  clientPriceStatus?: 'pending' | 'accepted' | 'rejected' | null;
  modelApproval?: 'pending' | 'approved' | 'rejected' | null;
  modelAccountLinked?: boolean | null;
  hasConflictWarning?: boolean;
  /** When set, distinguishes agency counter pending client response vs agency must act on client proposal */
  agencyCounterPrice?: number | null;
  proposedPrice?: number | null;
};

/**
 * Price accepted in DB plus at least one commercial anchor — use to lock counter/reject UI.
 * Stricter than RPC `client_confirm_option_job` (which only checks `client_price_status`).
 */
export function priceCommerciallySettledForUi(input: AttentionSignalInput): boolean {
  if (input.clientPriceStatus !== 'accepted') return false;
  const hasAgency =
    input.agencyCounterPrice != null && !Number.isNaN(Number(input.agencyCounterPrice));
  const hasProposed = input.proposedPrice != null && !Number.isNaN(Number(input.proposedPrice));
  return hasAgency || hasProposed;
}

/**
 * Who must act on price — only D1 fields. Call when `client_price_status !== 'accepted'` or to show thread/footer price state.
 */
export function deriveNegotiationAttention(input: AttentionSignalInput): NegotiationAttentionState {
  if (input.finalStatus === 'job_confirmed' || input.status === 'rejected') {
    return 'negotiation_terminal';
  }
  // Align D1 "deal closed" with footer lock — not raw `client_price_status` alone.
  if (priceCommerciallySettledForUi(input)) {
    return 'price_agreed';
  }
  const cps = input.clientPriceStatus ?? null;
  if (cps === 'rejected') {
    return 'counter_rejected';
  }
  if (cps === 'pending') {
    const hasAgencyCounter =
      input.agencyCounterPrice != null && !Number.isNaN(Number(input.agencyCounterPrice));
    if (hasAgencyCounter) {
      return 'waiting_for_client_response';
    }
    const hasProposed = input.proposedPrice != null && !Number.isNaN(Number(input.proposedPrice));
    if (hasProposed) {
      return 'waiting_for_agency_response';
    }
    return 'negotiation_open';
  }
  return 'negotiation_open';
}

/**
 * Approval / option→job — D2 only. Requires commercial settlement (same gate as footer lock), plus model + status + final_status.
 */
export function deriveApprovalAttention(input: AttentionSignalInput): ApprovalAttentionState {
  if (input.finalStatus === 'job_confirmed') {
    return 'job_completed';
  }
  if (input.status === 'rejected') {
    return 'fully_cleared';
  }
  if (!priceCommerciallySettledForUi(input)) {
    return 'approval_inactive';
  }

  const modelAccountLinked = input.modelAccountLinked !== false;
  const modelApproval = input.modelApproval ?? null;

  if (
    modelAccountLinked &&
    modelApproval === 'pending' &&
    input.status === 'in_negotiation' &&
    (input.finalStatus === 'option_confirmed' || input.finalStatus === 'option_pending')
  ) {
    return 'waiting_for_model_confirmation';
  }

  const canClientFinalizeJob =
    input.finalStatus === 'option_confirmed' &&
    (modelAccountLinked
      ? input.status === 'confirmed' && modelApproval === 'approved'
      : input.status === 'in_negotiation' || input.status === 'confirmed');

  if (canClientFinalizeJob) {
    return 'waiting_for_client_to_finalize_job';
  }

  if (input.finalStatus === 'option_confirmed' || input.status === 'confirmed') {
    return 'fully_cleared';
  }

  return 'fully_cleared';
}

/**
 * Legacy combined Smart Attention — composed from negotiation + approval so thread vs inbox stay consistent.
 * Prefer deriveNegotiationAttention / deriveApprovalAttention for new UI.
 */
export function deriveSmartAttentionState(input: AttentionSignalInput): SmartAttentionState {
  const finalStatus = input.finalStatus ?? null;
  const displayStatus = toDisplayStatus(input.status, finalStatus, {
    clientPriceStatus: input.clientPriceStatus ?? null,
    agencyCounterPrice: input.agencyCounterPrice ?? null,
    proposedPrice: input.proposedPrice ?? null,
  });
  const modelApproval = input.modelApproval ?? null;
  const clientPriceStatus = input.clientPriceStatus ?? null;
  const modelAccountLinked = input.modelAccountLinked !== false;

  if (finalStatus === 'job_confirmed') {
    return 'no_attention';
  }

  if (input.hasConflictWarning) {
    return 'conflict_risk';
  }

  if (!priceCommerciallySettledForUi(input)) {
    const n = deriveNegotiationAttention(input);
    if (n === 'negotiation_terminal') return 'no_attention';
    if (n === 'counter_rejected') return 'counter_pending';
    if (n === 'waiting_for_client_response') return 'waiting_for_client';
    if (n === 'waiting_for_agency_response' || n === 'negotiation_open') return 'waiting_for_agency';
    return 'waiting_for_agency';
  }

  if (
    modelAccountLinked &&
    modelApproval === 'pending' &&
    finalStatus === 'option_confirmed' &&
    input.status === 'in_negotiation'
  ) {
    return 'waiting_for_model';
  }

  if (
    finalStatus === 'option_confirmed' &&
    input.status === 'confirmed' &&
    (!modelAccountLinked || modelApproval === 'approved')
  ) {
    return 'job_confirmation_pending';
  }

  if (
    finalStatus === 'option_confirmed' &&
    !modelAccountLinked &&
    input.status === 'in_negotiation' &&
    clientPriceStatus === 'accepted'
  ) {
    return 'job_confirmation_pending';
  }

  if (displayStatus === 'Confirmed' || displayStatus === 'Rejected') {
    return 'no_attention';
  }

  if (clientPriceStatus === 'rejected') {
    return 'counter_pending';
  }

  if (clientPriceStatus === 'pending') {
    const hasAgencyCounter =
      input.agencyCounterPrice != null && !Number.isNaN(Number(input.agencyCounterPrice));
    if (hasAgencyCounter) {
      return 'waiting_for_client';
    }
    return 'waiting_for_agency';
  }

  if (modelAccountLinked && modelApproval === 'pending') {
    return 'waiting_for_model';
  }

  return 'waiting_for_client';
}

/**
 * Whether an option/casting request should contribute to the client web Messages tab
 * attention indicator (dot). Uses the same non-terminal semantics as {@link toDisplayStatus}
 * — not read receipts and not “last message from agency”.
 */
export function optionRequestNeedsMessagesTabAttention(r: {
  status: string;
  finalStatus?: string | null;
  clientPriceStatus?: 'pending' | 'accepted' | 'rejected' | null;
  agencyCounterPrice?: number | null;
  proposedPrice?: number | null;
}): boolean {
  const d = toDisplayStatus(r.status, r.finalStatus ?? null, {
    clientPriceStatus: r.clientPriceStatus,
    agencyCounterPrice: r.agencyCounterPrice,
    proposedPrice: r.proposedPrice,
  });
  return d === 'In negotiation' || d === 'Draft' || d === 'Price agreed';
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

/** Header / summary: approval-only copy (Dimension 2). */
export function approvalAttentionVisibleForRole(state: ApprovalAttentionState, role: SmartAttentionRole): boolean {
  if (state === 'approval_inactive' || state === 'fully_cleared' || state === 'job_completed') return false;
  if (state === 'waiting_for_model_confirmation') return role !== 'model';
  if (state === 'waiting_for_client_to_finalize_job') return role === 'client';
  return false;
}

/** Thread / negotiation footer: Dimension 1 visibility */
export function negotiationAttentionVisibleForRole(n: NegotiationAttentionState, role: SmartAttentionRole): boolean {
  if (n === 'negotiation_terminal' || n === 'price_agreed') return false;
  if (n === 'waiting_for_client_response') return role === 'client';
  if (n === 'waiting_for_agency_response' || n === 'counter_rejected' || n === 'negotiation_open') return role === 'agency';
  return false;
}

/** Maps store / UI option rows to attention input (include counter + proposed for negotiation direction). */
export function attentionSignalsFromOptionRequestLike(r: {
  status: string;
  finalStatus?: string | null;
  clientPriceStatus?: 'pending' | 'accepted' | 'rejected' | null;
  modelApproval?: 'pending' | 'approved' | 'rejected' | null;
  modelAccountLinked?: boolean | null;
  agencyCounterPrice?: number | null;
  proposedPrice?: number | null;
  hasConflictWarning?: boolean;
}): AttentionSignalInput {
  return {
    status: r.status,
    finalStatus: r.finalStatus ?? null,
    clientPriceStatus: r.clientPriceStatus ?? null,
    modelApproval: r.modelApproval ?? null,
    modelAccountLinked: r.modelAccountLinked,
    agencyCounterPrice: r.agencyCounterPrice ?? null,
    proposedPrice: r.proposedPrice ?? null,
    hasConflictWarning: r.hasConflictWarning ?? false,
  };
}

/** Client "Confirm job" — only when approval dimension says so (matches RPC `client_confirm_option_job`). */
export function clientMayConfirmJobFromSignals(input: AttentionSignalInput): boolean {
  return deriveApprovalAttention(input) === 'waiting_for_client_to_finalize_job';
}
