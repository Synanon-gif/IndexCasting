import { uiCopy } from '../constants/uiCopy';
import {
  statusBgColor,
  statusColor,
  toDisplayStatus,
  type DisplayStatus,
  type OptionPriceDisplaySignals,
} from './statusHelpers';

/** Maps toDisplayStatus() output to dashboard strings (uiCopy). */
export function workflowLabelFromDisplayStatus(display: DisplayStatus): string {
  switch (display) {
    case 'Draft':
      return uiCopy.dashboard.optionRequestWorkflowDraft;
    case 'Pending':
      return uiCopy.dashboard.optionRequestStatusPending;
    case 'In negotiation':
      return uiCopy.dashboard.optionRequestStatusInNegotiation;
    case 'Price agreed':
      return uiCopy.dashboard.optionRequestStatusPriceAgreed;
    case 'Option confirmed':
      return uiCopy.dashboard.optionRequestStatusOptionConfirmed;
    case 'Casting confirmed':
      return uiCopy.dashboard.optionRequestStatusCastingConfirmed;
    case 'Confirmed':
      return uiCopy.dashboard.optionRequestStatusConfirmed;
    case 'Rejected':
      return uiCopy.dashboard.optionRequestStatusRejected;
    default:
      return uiCopy.dashboard.optionRequestStatusPending;
  }
}

export type OptionRequestWorkflowBadge = {
  displayStatus: DisplayStatus;
  label: string;
  color: string;
  backgroundColor: string;
};

/** Canonical workflow badge for option_requests rows (negotiation UI + B2B org-chat cards). */
export function optionRequestWorkflowBadge(
  status: string | null,
  finalStatus: string | null,
  priceSignals?: OptionPriceDisplaySignals | null,
): OptionRequestWorkflowBadge {
  const displayStatus = toDisplayStatus(status, finalStatus, priceSignals);
  return {
    displayStatus,
    label: workflowLabelFromDisplayStatus(displayStatus),
    color: statusColor(displayStatus),
    backgroundColor: statusBgColor(displayStatus),
  };
}
