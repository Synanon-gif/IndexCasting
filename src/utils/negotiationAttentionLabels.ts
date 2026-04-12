import { uiCopy } from '../constants/uiCopy';
import type { SmartAttentionState, AttentionSignalInput } from './optionRequestAttention';
import {
  deriveApprovalAttention,
  deriveNegotiationAttention,
  approvalAttentionVisibleForRole,
  negotiationAttentionVisibleForRole,
  smartAttentionVisibleForRole,
} from './optionRequestAttention';

/**
 * Header chip label — action-priority logic:
 * "Action required" (this role must act) always beats "Waiting for X" (someone else must act).
 *
 * Priority: D2 action > D1 action > D2 waiting > D1 waiting
 */
export function attentionHeaderLabelFromSignals(
  input: AttentionSignalInput,
  role: 'agency' | 'client',
): string | null {
  const appr = deriveApprovalAttention(input);
  const neg = deriveNegotiationAttention(input);
  const action = uiCopy.dashboard.smartAttentionLabel;

  // ─── Tier 1: D2 action — this role must act on availability ───
  if (appr === 'waiting_for_agency_confirmation' && role === 'agency') return action;
  if (appr === 'waiting_for_client_to_finalize_job' && role === 'client') return action;

  // ─── Tier 2: D1 action — this role must act on price ───
  const agencyMustActOnPrice =
    neg === 'waiting_for_agency_response' || neg === 'negotiation_open' || neg === 'counter_rejected';
  if (role === 'agency' && agencyMustActOnPrice) return action;
  if (role === 'client' && neg === 'waiting_for_client_response') return action;

  // ─── Tier 3: D2 waiting — someone else must act on availability ───
  if (approvalAttentionVisibleForRole(appr, role)) {
    if (appr === 'waiting_for_agency_confirmation') {
      return uiCopy.dashboard.smartAttentionWaitingForAgencyConfirmation;
    }
    if (appr === 'waiting_for_model_confirmation') {
      return uiCopy.dashboard.smartAttentionWaitingForModel;
    }
    if (appr === 'waiting_for_client_to_finalize_job') {
      return uiCopy.dashboard.smartAttentionJobConfirmationPending;
    }
  }

  // ─── Tier 4: D1 waiting — someone else must act on price ───
  if (negotiationAttentionVisibleForRole(neg, role)) {
    switch (neg) {
      case 'waiting_for_client_response':
        return uiCopy.dashboard.smartAttentionWaitingForClient;
      case 'waiting_for_agency_response':
      case 'counter_rejected':
      case 'negotiation_open':
        return uiCopy.dashboard.smartAttentionWaitingForAgency;
    }
  }

  return null;
}

/**
 * @deprecated Use attentionHeaderLabelFromSignals with full AttentionSignalInput
 */
export function attentionHeaderLabel(
  state: SmartAttentionState,
  role: 'agency' | 'client',
): string | null {
  if (!smartAttentionVisibleForRole(state, role)) return null;

  const action = uiCopy.dashboard.smartAttentionLabel;

  switch (state) {
    case 'waiting_for_agency':
      return role === 'agency' ? action : uiCopy.dashboard.smartAttentionWaitingForAgency;
    case 'waiting_for_client':
      return role === 'client' ? action : uiCopy.dashboard.smartAttentionWaitingForClient;
    case 'waiting_for_model':
      return uiCopy.dashboard.smartAttentionWaitingForModel;
    case 'counter_pending':
      return role === 'agency' ? action : uiCopy.dashboard.smartAttentionCounterPending;
    case 'conflict_risk':
      return role === 'agency' ? action : uiCopy.dashboard.smartAttentionConflictRisk;
    case 'job_confirmation_pending':
      return role === 'client' ? action : uiCopy.dashboard.smartAttentionJobConfirmationPending;
    case 'no_attention':
    default:
      return null;
  }
}
