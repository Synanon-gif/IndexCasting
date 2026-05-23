import { uiCopy } from '../../constants/uiCopy';
import {
  optionRequestWorkflowBadge,
  workflowLabelFromDisplayStatus,
} from '../negotiationWorkflowLabel';

describe('workflowLabelFromDisplayStatus', () => {
  it('maps every DisplayStatus to uiCopy (Option confirmed is not Pending)', () => {
    expect(workflowLabelFromDisplayStatus('Draft')).toBe(
      uiCopy.dashboard.optionRequestWorkflowDraft,
    );
    expect(workflowLabelFromDisplayStatus('In negotiation')).toBe(
      uiCopy.dashboard.optionRequestStatusInNegotiation,
    );
    expect(workflowLabelFromDisplayStatus('Price agreed')).toBe(
      uiCopy.dashboard.optionRequestStatusPriceAgreed,
    );
    expect(workflowLabelFromDisplayStatus('Option confirmed')).toBe(
      uiCopy.dashboard.optionRequestStatusOptionConfirmed,
    );
    expect(workflowLabelFromDisplayStatus('Confirmed')).toBe(
      uiCopy.dashboard.optionRequestStatusConfirmed,
    );
    expect(workflowLabelFromDisplayStatus('Rejected')).toBe(
      uiCopy.dashboard.optionRequestStatusRejected,
    );
  });
});

describe('optionRequestWorkflowBadge', () => {
  it('uses toDisplayStatus + uiCopy for in_negotiation + option_confirmed', () => {
    const badge = optionRequestWorkflowBadge('in_negotiation', 'option_confirmed');
    expect(badge.displayStatus).toBe('Option confirmed');
    expect(badge.label).toBe('Option confirmed');
    expect(badge.label).not.toBe(uiCopy.dashboard.optionRequestStatusPending);
  });

  it('shows Price agreed when commercial settlement is met before availability', () => {
    const badge = optionRequestWorkflowBadge('in_negotiation', 'option_pending', {
      clientPriceStatus: 'accepted',
      proposedPrice: 500,
      agencyCounterPrice: null,
    });
    expect(badge.displayStatus).toBe('Price agreed');
    expect(badge.label).toBe(uiCopy.dashboard.optionRequestStatusPriceAgreed);
  });
});
