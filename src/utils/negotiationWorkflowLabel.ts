import { uiCopy } from '../constants/uiCopy';
import type { DisplayStatus } from './statusHelpers';

/** Maps toDisplayStatus() output to existing dashboard strings — no new status types. */
export function workflowLabelFromDisplayStatus(display: DisplayStatus): string {
  switch (display) {
    case 'Draft':
      return uiCopy.dashboard.optionRequestWorkflowDraft;
    case 'In negotiation':
      return uiCopy.dashboard.optionRequestStatusInNegotiation;
    case 'Confirmed':
      return uiCopy.dashboard.optionRequestStatusConfirmed;
    case 'Rejected':
      return uiCopy.dashboard.optionRequestStatusRejected;
    default:
      return uiCopy.dashboard.optionRequestStatusPending;
  }
}
