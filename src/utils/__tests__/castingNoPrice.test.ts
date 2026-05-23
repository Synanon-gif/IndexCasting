import {
  deriveApprovalAttention,
  deriveNegotiationAttention,
  attentionSignalsFromOptionRequestLike,
} from '../optionRequestAttention';
import { attentionHeaderLabelFromSignals } from '../negotiationAttentionLabels';
import {
  shouldShowAgencyAcceptDeclineProposedFee,
  shouldShowAgencyProposeInitialFee,
  shouldShowAgencySendCounterOffer,
} from '../negotiationAgencyPriceActions';
import { shouldShowClientAcceptCounterAction } from '../negotiationClientCounterActions';
import {
  isPriceNegotiationRequest,
  shouldShowPriceNegotiationControls,
} from '../priceNegotiationRequest';
import { uiCopy } from '../../constants/uiCopy';

const actionLabel = uiCopy.dashboard.smartAttentionLabel;

const castingOpen = {
  status: 'in_negotiation' as const,
  finalStatus: 'option_pending' as const,
  clientPriceStatus: 'pending' as const,
  requestType: 'casting' as const,
  modelAccountLinked: false,
};

const optionOpen = {
  ...castingOpen,
  requestType: 'option' as const,
  proposedPrice: null as number | null,
};

describe('casting no-price enforcement', () => {
  it('isPriceNegotiationRequest is false for casting', () => {
    expect(isPriceNegotiationRequest('casting')).toBe(false);
    expect(isPriceNegotiationRequest('option')).toBe(true);
    expect(shouldShowPriceNegotiationControls({ requestType: 'casting' })).toBe(false);
  });

  it('deriveNegotiationAttention ignores price fields for casting', () => {
    const withProposed = {
      ...castingOpen,
      proposedPrice: 100,
      agencyCounterPrice: 200,
    };
    expect(deriveNegotiationAttention(withProposed)).toBe('price_agreed');
    expect(deriveNegotiationAttention(optionOpen)).toBe('negotiation_open');
  });

  it('deriveApprovalAttention uses availability for casting without price gate', () => {
    expect(deriveApprovalAttention(castingOpen)).toBe('waiting_for_agency_confirmation');
    expect(deriveApprovalAttention(optionOpen)).toBe('approval_inactive');
  });

  it('casting action required is availability-only (agency confirm)', () => {
    const sig = attentionSignalsFromOptionRequestLike(castingOpen);
    expect(attentionHeaderLabelFromSignals(sig, 'agency')).toBe(actionLabel);
    expect(attentionHeaderLabelFromSignals(sig, 'client')).toMatch(/agency/i);
  });

  it('agency casting thread does not show price CTAs', () => {
    const input = { isAgency: true, ...castingOpen, proposedPrice: 500 };
    expect(shouldShowAgencySendCounterOffer(input)).toBe(false);
    expect(shouldShowAgencyProposeInitialFee(input)).toBe(false);
    expect(shouldShowAgencyAcceptDeclineProposedFee(input)).toBe(false);
  });

  it('client casting thread does not show accept counter', () => {
    expect(
      shouldShowClientAcceptCounterAction({
        isAgency: false,
        ...castingOpen,
        agencyCounterPrice: 300,
      }),
    ).toBe(false);
  });

  it('option still shows propose fee and counter when D1 open', () => {
    const input = { isAgency: true, ...optionOpen };
    expect(shouldShowAgencyProposeInitialFee(input)).toBe(true);
    expect(shouldShowAgencySendCounterOffer(input)).toBe(true);
  });

  it('option with counter still shows client accept', () => {
    expect(
      shouldShowClientAcceptCounterAction({
        isAgency: false,
        status: 'in_negotiation',
        finalStatus: 'option_confirmed',
        clientPriceStatus: 'pending',
        agencyCounterPrice: 400,
        requestType: 'option',
        modelAccountLinked: true,
        modelApproval: 'approved',
      }),
    ).toBe(true);
  });

  it('job confirmed does not show price actions', () => {
    const job = {
      isAgency: true,
      status: 'confirmed',
      finalStatus: 'job_confirmed',
      clientPriceStatus: 'accepted' as const,
      requestType: 'option' as const,
    };
    expect(shouldShowAgencyProposeInitialFee(job)).toBe(false);
    expect(deriveNegotiationAttention(job)).toBe('negotiation_terminal');
  });
});
