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
 * Header chip label — prefers approval attention (B); if inactive, negotiation attention (A).
 * Returns null when no attention should surface for this role.
 */
export function attentionHeaderLabelFromSignals(
  input: AttentionSignalInput,
  role: 'agency' | 'client',
): string | null {
  const appr = deriveApprovalAttention(input);
  if (approvalAttentionVisibleForRole(appr, role)) {
    if (appr === 'waiting_for_agency_confirmation') {
      return role === 'agency'
        ? uiCopy.dashboard.smartAttentionLabel
        : uiCopy.dashboard.smartAttentionWaitingForAgencyConfirmation;
    }
    if (appr === 'waiting_for_model_confirmation') {
      return uiCopy.dashboard.smartAttentionWaitingForModel;
    }
    if (appr === 'waiting_for_client_to_finalize_job') {
      return role === 'client'
        ? uiCopy.dashboard.smartAttentionLabel
        : uiCopy.dashboard.smartAttentionJobConfirmationPending;
    }
    return null;
  }

  const neg = deriveNegotiationAttention(input);
  if (!negotiationAttentionVisibleForRole(neg, role)) {
    return null;
  }

  const action = uiCopy.dashboard.smartAttentionLabel;

  switch (neg) {
    case 'waiting_for_client_response':
      return role === 'client' ? action : uiCopy.dashboard.smartAttentionWaitingForClient;
    case 'waiting_for_agency_response':
      return role === 'agency' ? action : uiCopy.dashboard.smartAttentionWaitingForAgency;
    case 'counter_rejected':
      return role === 'agency' ? action : uiCopy.dashboard.smartAttentionWaitingForAgency;
    case 'negotiation_open':
      return role === 'agency' ? action : uiCopy.dashboard.smartAttentionWaitingForAgency;
    default:
      return null;
  }
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
