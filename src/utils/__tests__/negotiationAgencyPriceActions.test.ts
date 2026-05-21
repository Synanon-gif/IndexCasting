import { deriveNegotiationAttention, deriveApprovalAttention } from '../optionRequestAttention';
import { attentionHeaderLabelFromSignals } from '../negotiationAttentionLabels';
import {
  isAgencyAwaitingClientOnCounter,
  shouldShowAgencyAcceptDeclineProposedFee,
  shouldShowAgencyProposeInitialFee,
  shouldShowAgencySendCounterOffer,
  shouldShowAgencyPriceNegotiationActions,
} from '../negotiationAgencyPriceActions';

/** User scenario: model approved → status=confirmed; client declined agency counter. */
const agencyAfterClientDeclineConfirmed = {
  isAgency: true,
  status: 'confirmed' as const,
  finalStatus: 'option_confirmed' as const,
  clientPriceStatus: 'rejected' as const,
  agencyCounterPrice: 2,
  proposedPrice: 1,
  modelApproval: 'approved' as const,
  modelAccountLinked: true,
  isAgencyOnly: false,
  requestType: 'option' as const,
};

describe('shouldShowAgencySendCounterOffer — after client decline', () => {
  it('shows counter input when status=confirmed and client_price_status=rejected', () => {
    expect(shouldShowAgencySendCounterOffer(agencyAfterClientDeclineConfirmed)).toBe(true);
  });

  it('does not require negotiationCounterExpanded (dead toggle removed)', () => {
    expect(shouldShowAgencyPriceNegotiationActions(agencyAfterClientDeclineConfirmed)).toBe(true);
    expect(isAgencyAwaitingClientOnCounter(agencyAfterClientDeclineConfirmed)).toBe(false);
  });

  it('header Action required matches footer counter visibility', () => {
    const signals = {
      status: agencyAfterClientDeclineConfirmed.status,
      finalStatus: agencyAfterClientDeclineConfirmed.finalStatus,
      clientPriceStatus: agencyAfterClientDeclineConfirmed.clientPriceStatus,
      agencyCounterPrice: agencyAfterClientDeclineConfirmed.agencyCounterPrice,
      proposedPrice: agencyAfterClientDeclineConfirmed.proposedPrice,
      modelApproval: agencyAfterClientDeclineConfirmed.modelApproval,
      modelAccountLinked: agencyAfterClientDeclineConfirmed.modelAccountLinked,
      isAgencyOnly: false,
      requestType: agencyAfterClientDeclineConfirmed.requestType,
    };
    expect(deriveNegotiationAttention(signals)).toBe('counter_rejected');
    expect(deriveApprovalAttention(signals)).toBe('fully_cleared');
    expect(attentionHeaderLabelFromSignals(signals, 'agency')).not.toBeNull();
    expect(shouldShowAgencySendCounterOffer(agencyAfterClientDeclineConfirmed)).toBe(true);
  });
});

describe('isAgencyAwaitingClientOnCounter — blocks double counter', () => {
  const awaitingClient = {
    ...agencyAfterClientDeclineConfirmed,
    clientPriceStatus: 'pending' as const,
    agencyCounterPrice: 2,
  };

  it('true while client decides on pending counter', () => {
    expect(isAgencyAwaitingClientOnCounter(awaitingClient)).toBe(true);
    expect(shouldShowAgencySendCounterOffer(awaitingClient)).toBe(false);
  });

  it('false after client rejects (agency may re-counter)', () => {
    expect(isAgencyAwaitingClientOnCounter(agencyAfterClientDeclineConfirmed)).toBe(false);
  });
});

describe('shouldShowAgencyAcceptDeclineProposedFee', () => {
  it('shows when client proposed fee and agency has not countered', () => {
    expect(
      shouldShowAgencyAcceptDeclineProposedFee({
        isAgency: true,
        status: 'in_negotiation',
        finalStatus: 'option_pending',
        clientPriceStatus: 'pending',
        proposedPrice: 100,
        agencyCounterPrice: null,
        isAgencyOnly: false,
      }),
    ).toBe(true);
  });

  it('hides when status=confirmed but client already rejected counter', () => {
    expect(shouldShowAgencyAcceptDeclineProposedFee(agencyAfterClientDeclineConfirmed)).toBe(false);
  });
});

describe('shouldShowAgencyProposeInitialFee', () => {
  it('shows when no proposed price and negotiation open', () => {
    expect(
      shouldShowAgencyProposeInitialFee({
        isAgency: true,
        status: 'in_negotiation',
        finalStatus: 'option_pending',
        clientPriceStatus: 'pending',
        proposedPrice: null,
        agencyCounterPrice: null,
        isAgencyOnly: false,
      }),
    ).toBe(true);
  });

  it('hides for agency-only flows', () => {
    expect(
      shouldShowAgencyProposeInitialFee({
        isAgency: true,
        status: 'in_negotiation',
        finalStatus: 'option_confirmed',
        clientPriceStatus: 'pending',
        proposedPrice: null,
        agencyCounterPrice: null,
        isAgencyOnly: true,
      }),
    ).toBe(false);
  });
});

describe('legacy in_negotiation path parity', () => {
  it('counter after decline still works when status=in_negotiation', () => {
    expect(
      shouldShowAgencySendCounterOffer({
        ...agencyAfterClientDeclineConfirmed,
        status: 'in_negotiation',
      }),
    ).toBe(true);
  });
});
