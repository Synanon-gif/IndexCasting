import { uiCopy } from '../constants/uiCopy';
import type { SmartAttentionState } from './optionRequestAttention';
import { smartAttentionVisibleForRole } from './optionRequestAttention';

/**
 * Header chip label for negotiation — uses existing Smart Attention state + uiCopy only.
 * Returns null when no attention should surface for this role (same gate as lists).
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
