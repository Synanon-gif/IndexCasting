import { uiCopy } from '../../constants/uiCopy';
import {
  agencyNegotiationThreadSummaryHint,
  optionConfirmedBannerLabel,
} from '../modelAccountNegotiationCopy';

describe('agencyNegotiationThreadSummaryHint', () => {
  it('no linked model → no-app hint', () => {
    expect(
      agencyNegotiationThreadSummaryHint({
        modelAccountLinked: false,
        modelApproval: 'approved',
        finalStatus: 'option_confirmed',
        status: 'in_negotiation',
      }),
    ).toBe(uiCopy.optionNegotiationChat.noModelAppNegotiationHint);
  });

  it('linked + model approved → availability confirmed hint', () => {
    expect(
      agencyNegotiationThreadSummaryHint({
        modelAccountLinked: true,
        modelApproval: 'approved',
        finalStatus: 'option_confirmed',
        status: 'in_negotiation',
      }),
    ).toBe(uiCopy.optionNegotiationChat.modelAvailabilityConfirmedHint);
  });

  it('linked + pending + agency not yet confirmed → instruct agency first (not “model first”)', () => {
    expect(
      agencyNegotiationThreadSummaryHint({
        modelAccountLinked: true,
        modelApproval: 'pending',
        finalStatus: 'option_pending',
        status: 'in_negotiation',
      }),
    ).toBe(uiCopy.optionNegotiationChat.agencyConfirmAvailabilityBeforeModelStep);
  });

  it('linked + pending + option_confirmed → waiting for model in app', () => {
    expect(
      agencyNegotiationThreadSummaryHint({
        modelAccountLinked: true,
        modelApproval: 'pending',
        finalStatus: 'option_confirmed',
        status: 'in_negotiation',
      }),
    ).toBe(uiCopy.optionNegotiationChat.agencyWaitingForModelAfterAvailability);
  });
});

describe('optionConfirmedBannerLabel', () => {
  it('option_confirmed + linked + model pending → awaiting model banner', () => {
    expect(
      optionConfirmedBannerLabel({
        finalStatus: 'option_confirmed',
        modelAccountLinked: true,
        modelApproval: 'pending',
      }),
    ).toBe(uiCopy.dashboard.optionRequestStatusAvailabilityConfirmedAwaitingModel);
  });

  it('option_confirmed + no pending model → short confirmed', () => {
    expect(
      optionConfirmedBannerLabel({
        finalStatus: 'option_confirmed',
        modelAccountLinked: false,
        modelApproval: 'approved',
      }),
    ).toBe(uiCopy.dashboard.optionRequestStatusConfirmed);
  });
});
