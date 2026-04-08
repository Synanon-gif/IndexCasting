import { uiCopy } from '../uiCopy';

describe('option/casting status copy', () => {
  it('keeps unified negotiation label', () => {
    expect(uiCopy.dashboard.optionRequestStatusInNegotiation).toBe('In negotiation');
  });

  it('keeps unified approval labels', () => {
    expect(uiCopy.dashboard.optionRequestModelApprovalApproved).toBe('Model approved');
    expect(uiCopy.dashboard.optionRequestModelApprovalRejected).toBe('Model rejected');
    expect(uiCopy.dashboard.optionRequestModelApprovalPending).toBe('Pending model approval');
    expect(uiCopy.dashboard.optionRequestModelApprovalNoApp).toBe('No model app account');
  });

  it('keeps final status and context labels consistent', () => {
    expect(uiCopy.dashboard.optionRequestStatusConfirmed).toBe('Confirmed');
    expect(uiCopy.dashboard.optionRequestStatusJobConfirmed).toBe('Job confirmed');
    expect(uiCopy.dashboard.optionRequestStatusPending).toBe('Pending');
    expect(uiCopy.dashboard.threadContextOption).toBe('Option');
    expect(uiCopy.dashboard.threadContextCasting).toBe('Casting');
  });
});
