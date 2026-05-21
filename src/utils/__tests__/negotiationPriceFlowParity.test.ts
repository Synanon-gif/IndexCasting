/**
 * End-to-end parity: Axis-1 price CTAs must stay visible/actionable when
 * status='confirmed' (model approved availability) — the classic regression class.
 */
import {
  clientMayConfirmJobFromSignals,
  deriveNegotiationAttention,
  deriveApprovalAttention,
} from '../optionRequestAttention';
import { attentionHeaderLabelFromSignals } from '../negotiationAttentionLabels';
import { shouldShowClientAcceptCounterAction } from '../negotiationClientCounterActions';
import {
  isAgencyAwaitingClientOnCounter,
  shouldShowAgencyAcceptDeclineProposedFee,
  shouldShowAgencySendCounterOffer,
} from '../negotiationAgencyPriceActions';

const baseConfirmedAvailability = {
  status: 'confirmed' as const,
  finalStatus: 'option_confirmed' as const,
  modelApproval: 'approved' as const,
  modelAccountLinked: true,
  isAgencyOnly: false,
  requestType: 'option' as const,
  proposedPrice: 1,
};

function signalsFrom(input: Record<string, unknown>) {
  return {
    status: input.status as string,
    finalStatus: input.finalStatus as string,
    clientPriceStatus: input.clientPriceStatus as 'pending' | 'accepted' | 'rejected',
    agencyCounterPrice: input.agencyCounterPrice as number | null,
    proposedPrice: input.proposedPrice as number | null,
    modelApproval: input.modelApproval as 'pending' | 'approved' | 'rejected',
    modelAccountLinked: input.modelAccountLinked as boolean,
    isAgencyOnly: false,
    requestType: 'option' as const,
  };
}

describe('negotiation price flow parity — status=confirmed lifecycles', () => {
  describe('round 1: agency counter → client decline → agency re-counter', () => {
    const afterClientDecline = {
      ...baseConfirmedAvailability,
      clientPriceStatus: 'rejected' as const,
      agencyCounterPrice: 2,
    };

    it('agency: header + counter UI aligned (D1 counter_rejected)', () => {
      const sig = signalsFrom(afterClientDecline);
      expect(deriveNegotiationAttention(sig)).toBe('counter_rejected');
      expect(attentionHeaderLabelFromSignals(sig, 'agency')).not.toBeNull();
      expect(shouldShowAgencySendCounterOffer({ isAgency: true, ...afterClientDecline })).toBe(
        true,
      );
      expect(isAgencyAwaitingClientOnCounter({ isAgency: true, ...afterClientDecline })).toBe(
        false,
      );
    });

    it('client: waiting for agency after decline', () => {
      const sig = signalsFrom(afterClientDecline);
      expect(attentionHeaderLabelFromSignals(sig, 'client')).toMatch(/agency/i);
      expect(shouldShowClientAcceptCounterAction({ isAgency: false, ...afterClientDecline })).toBe(
        false,
      );
    });
  });

  describe('round 2: agency sends new counter → client accepts → confirm job', () => {
    const clientDeciding = {
      ...baseConfirmedAvailability,
      clientPriceStatus: 'pending' as const,
      agencyCounterPrice: 3,
    };

    it('agency: cannot double-counter while client decides', () => {
      expect(shouldShowAgencySendCounterOffer({ isAgency: true, ...clientDeciding })).toBe(false);
      expect(isAgencyAwaitingClientOnCounter({ isAgency: true, ...clientDeciding })).toBe(true);
    });

    it('client: accept counter visible despite status=confirmed', () => {
      const sig = signalsFrom(clientDeciding);
      expect(deriveNegotiationAttention(sig)).toBe('waiting_for_client_response');
      expect(shouldShowClientAcceptCounterAction({ isAgency: false, ...clientDeciding })).toBe(
        true,
      );
      expect(clientMayConfirmJobFromSignals(sig)).toBe(false);
    });

    const afterClientAccept = {
      ...clientDeciding,
      clientPriceStatus: 'accepted' as const,
    };

    it('client: confirm job after price settled', () => {
      const sig = signalsFrom(afterClientAccept);
      expect(deriveNegotiationAttention(sig)).toBe('price_agreed');
      expect(deriveApprovalAttention(sig)).toBe('waiting_for_client_to_finalize_job');
      expect(clientMayConfirmJobFromSignals(sig)).toBe(true);
      expect(shouldShowClientAcceptCounterAction({ isAgency: false, ...afterClientAccept })).toBe(
        false,
      );
    });
  });

  describe('agency accept proposed fee after model confirmed availability', () => {
    const agencyMustAcceptProposed = {
      ...baseConfirmedAvailability,
      clientPriceStatus: 'pending' as const,
      proposedPrice: 100,
      agencyCounterPrice: null as number | null,
    };

    it('agency accept/decline proposed fee when status=confirmed', () => {
      const sig = signalsFrom(agencyMustAcceptProposed);
      expect(deriveNegotiationAttention(sig)).toBe('waiting_for_agency_response');
      expect(
        shouldShowAgencyAcceptDeclineProposedFee({ isAgency: true, ...agencyMustAcceptProposed }),
      ).toBe(true);
      expect(
        shouldShowAgencySendCounterOffer({ isAgency: true, ...agencyMustAcceptProposed }),
      ).toBe(true);
    });
  });

  describe('legacy in_negotiation paths remain valid', () => {
    const inNegotiationPendingCounter = {
      ...baseConfirmedAvailability,
      status: 'in_negotiation' as const,
      finalStatus: 'option_confirmed' as const,
      clientPriceStatus: 'pending' as const,
      agencyCounterPrice: 2,
    };

    it('client accept counter on in_negotiation', () => {
      expect(
        shouldShowClientAcceptCounterAction({
          isAgency: false,
          ...inNegotiationPendingCounter,
        }),
      ).toBe(true);
    });

    it('agency re-counter after decline on in_negotiation', () => {
      expect(
        shouldShowAgencySendCounterOffer({
          isAgency: true,
          ...inNegotiationPendingCounter,
          clientPriceStatus: 'rejected',
        }),
      ).toBe(true);
    });
  });
});
