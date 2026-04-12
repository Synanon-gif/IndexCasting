import { priceCommerciallySettled } from './priceSettlement';

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
 * Dimension 2 — availability / approvals / option→job.
 * Independent of D1 (price). Agency confirmation is signaled by final_status.
 * Job finalization still requires BOTH axes (price agreed + availability confirmed).
 */
export type ApprovalAttentionState =
  | 'approval_inactive'
  | 'waiting_for_agency_confirmation'
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
 * Delegates to centralized `priceCommerciallySettled` to avoid duplication.
 */
export function priceCommerciallySettledForUi(input: AttentionSignalInput): boolean {
  return priceCommerciallySettled(input);
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
 * Approval / availability — D2 only.
 * DECOUPLED from D1 (price): availability status is derived independently.
 * Job finalization requires BOTH axes (price settled + availability cleared).
 *
 * CANONICAL NON-RETROACTIVE RULE (20260615):
 * A lifecycle confirmed under the no-model-account branch stays confirmed
 * forever. The DB trigger (sync_model_account_linked) must NOT reset
 * model_approval for rows with final_status IN ('option_confirmed',
 * 'job_confirmed'). If somehow a confirmed row still has model_approval =
 * 'pending' + model_account_linked = true, treat model_approval = 'approved'
 * for confirmed lifecycles (defense-in-depth).
 *
 * SEMANTIC NOTE — "grandfathered approved":
 * model_approval = 'approved' on no-model-account lifecycles means
 * "availability was cleared by the agency under the no-account flow" — NOT
 * "the model actively confirmed". The value is functionally equivalent for
 * all derive/attention logic but must never be confused with an active
 * model confirmation. It is a grandfathered/auto-approved state that
 * protects already-confirmed lifecycles from retroactive reopening.
 */
export function deriveApprovalAttention(input: AttentionSignalInput): ApprovalAttentionState {
  if (input.finalStatus === 'job_confirmed') {
    return 'job_completed';
  }
  if (input.status === 'rejected') {
    return 'fully_cleared';
  }

  const agencyConfirmed = input.finalStatus === 'option_confirmed';
  const modelAccountLinked = input.modelAccountLinked === true;
  const modelApproval = input.modelApproval ?? null;
  const priceSettled = priceCommerciallySettledForUi(input);

  if (agencyConfirmed) {
    // Defense-in-depth: if status is already 'confirmed' (fully settled),
    // model approval cannot be retroactively required regardless of current
    // model_approval field value. The lifecycle is terminal.
    if (input.status === 'confirmed') {
      return priceSettled ? 'waiting_for_client_to_finalize_job' : 'fully_cleared';
    }

    if (
      modelAccountLinked &&
      modelApproval === 'pending' &&
      input.status === 'in_negotiation'
    ) {
      return 'waiting_for_model_confirmation';
    }

    const availabilityCleared = !modelAccountLinked || modelApproval === 'approved';

    if (availabilityCleared && priceSettled) {
      return 'waiting_for_client_to_finalize_job';
    }

    if (availabilityCleared) {
      return 'fully_cleared';
    }

    return 'fully_cleared';
  }

  // Agency hasn't confirmed availability yet.
  // Signal "waiting for agency" only when price is already settled (Flow 1).
  if (priceSettled) {
    return 'waiting_for_agency_confirmation';
  }

  return 'approval_inactive';
}

/**
 * Legacy combined Smart Attention — composed from D1 (negotiation) + D2 (approval).
 * Action-priority: "this role must act" signals win over "waiting for X" signals.
 * Prefer deriveNegotiationAttention / deriveApprovalAttention for new UI.
 */
export function deriveSmartAttentionState(input: AttentionSignalInput): SmartAttentionState {
  const finalStatus = input.finalStatus ?? null;

  if (finalStatus === 'job_confirmed') {
    return 'no_attention';
  }

  if (input.status === 'rejected') {
    return 'no_attention';
  }

  if (input.hasConflictWarning) {
    return 'conflict_risk';
  }

  const appr = deriveApprovalAttention(input);
  const n = deriveNegotiationAttention(input);

  // D2 action states (agency/client must act on availability)
  if (appr === 'waiting_for_client_to_finalize_job') {
    return 'job_confirmation_pending';
  }
  if (appr === 'waiting_for_agency_confirmation') {
    return 'waiting_for_agency';
  }

  // D1 action states (agency/client must act on price)
  if (n === 'counter_rejected') return 'counter_pending';
  if (n === 'waiting_for_client_response') return 'waiting_for_client';
  if (n === 'waiting_for_agency_response' || n === 'negotiation_open') return 'waiting_for_agency';

  // D2 waiting states (someone else must act on availability)
  if (appr === 'waiting_for_model_confirmation') {
    return 'waiting_for_model';
  }

  // D1 terminal
  if (n === 'negotiation_terminal' || n === 'price_agreed') return 'no_attention';

  return 'no_attention';
}

/**
 * Whether an option/casting request should contribute to the client web Messages tab
 * attention indicator (dot).
 *
 * Canonical rule: derives from the same D1 (negotiation) + D2 (approval) attention
 * logic as `attentionHeaderLabelFromSignals` so the tab-dot and the thread header can
 * never disagree. Inline re-implementation to avoid a circular import
 * (negotiationAttentionLabels.ts imports from this file).
 *
 * Result: true when `attentionHeaderLabelFromSignals(input, 'client') !== null`.
 */
export function optionRequestNeedsMessagesTabAttention(r: {
  status: string;
  finalStatus?: string | null;
  clientPriceStatus?: 'pending' | 'accepted' | 'rejected' | null;
  agencyCounterPrice?: number | null;
  proposedPrice?: number | null;
  modelApproval?: 'pending' | 'approved' | 'rejected' | null;
  modelAccountLinked?: boolean | null;
}): boolean {
  const input: AttentionSignalInput = {
    status: r.status,
    finalStatus: r.finalStatus ?? null,
    clientPriceStatus: r.clientPriceStatus ?? null,
    modelApproval: r.modelApproval ?? null,
    modelAccountLinked: r.modelAccountLinked,
    agencyCounterPrice: r.agencyCounterPrice ?? null,
    proposedPrice: r.proposedPrice ?? null,
  };

  // D2: approval attention visible for client — mirrors attentionHeaderLabelFromSignals D2 branch
  const appr = deriveApprovalAttention(input);
  if (approvalAttentionVisibleForRole(appr, 'client')) {
    return true;
  }

  // D1: negotiation attention visible for client — mirrors attentionHeaderLabelFromSignals D1 branch
  const neg = deriveNegotiationAttention(input);
  return negotiationAttentionVisibleForRole(neg, 'client');
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
  const modelAccountLinked = input.modelAccountLinked === true;
  if (modelAccountLinked && input.modelApproval === 'pending') return 1;
  return 2;
}

export function smartAttentionVisibleForRole(state: SmartAttentionState, role: SmartAttentionRole): boolean {
  if (state === 'no_attention') return false;
  if (state === 'job_confirmation_pending') return role === 'client';
  if (state === 'waiting_for_model') return role !== 'model';
  if (state === 'waiting_for_agency' || state === 'counter_pending' || state === 'conflict_risk') {
    return role === 'agency' || role === 'client';
  }
  if (state === 'waiting_for_client') return role === 'client';
  return true;
}

/** Header / summary: approval-only copy (Dimension 2). */
export function approvalAttentionVisibleForRole(state: ApprovalAttentionState, role: SmartAttentionRole): boolean {
  if (state === 'approval_inactive' || state === 'fully_cleared' || state === 'job_completed') return false;
  if (state === 'waiting_for_agency_confirmation') return role === 'client' || role === 'agency';
  if (state === 'waiting_for_model_confirmation') return role !== 'model';
  if (state === 'waiting_for_client_to_finalize_job') return role === 'client';
  return false;
}

/** Thread / negotiation footer: Dimension 1 visibility */
export function negotiationAttentionVisibleForRole(n: NegotiationAttentionState, role: SmartAttentionRole): boolean {
  if (n === 'negotiation_terminal' || n === 'price_agreed') return false;
  if (n === 'waiting_for_client_response') return role === 'client';
  if (n === 'waiting_for_agency_response' || n === 'counter_rejected' || n === 'negotiation_open') {
    return role === 'agency' || role === 'client';
  }
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
