import { uiCopy } from '../constants/uiCopy';
import type { DisplayStatus } from './statusHelpers';

/** Maps toDisplayStatus() output to dashboard strings (uiCopy). */
export function workflowLabelFromDisplayStatus(display: DisplayStatus): string {
  switch (display) {
    case 'Draft':
      return uiCopy.dashboard.optionRequestWorkflowDraft;
    case 'In negotiation':
      return uiCopy.dashboard.optionRequestStatusInNegotiation;
    case 'Price agreed':
      return uiCopy.dashboard.optionRequestStatusPriceAgreed;
    case 'Confirmed':
      return uiCopy.dashboard.optionRequestStatusConfirmed;
    case 'Rejected':
      return uiCopy.dashboard.optionRequestStatusRejected;
    default:
      return uiCopy.dashboard.optionRequestStatusPending;
  }
}
