import {
  clientMayConfirmJobFromSignals,
  deriveApprovalAttention,
  deriveNegotiationAttention,
} from '../optionRequestAttention';
import { attentionHeaderLabelFromSignals } from '../negotiationAttentionLabels';
import {
  isAgencyPriceNegotiationOpen,
  shouldShowClientAcceptCounterAction,
} from '../negotiationClientCounterActions';

/** Regression: model approval flips status to confirmed while counter still pending. */
const confirmedWithPendingCounter = {
  isAgency: false,
  status: 'confirmed' as const,
  finalStatus: 'option_confirmed' as const,
  clientPriceStatus: 'pending' as const,
  agencyCounterPrice: 2,
  proposedPrice: 1,
  modelApproval: 'approved' as const,
  modelAccountLinked: true,
  isAgencyOnly: false,
  requestType: 'option' as const,
};

describe('shouldShowClientAcceptCounterAction', () => {
  it('shows Accept agency proposal when status=confirmed and counter pending (deadlock fix)', () => {
    expect(shouldShowClientAcceptCounterAction(confirmedWithPendingCounter)).toBe(true);
  });

  it('does not show Confirm Job until client accepts counter', () => {
    const signals = {
      status: confirmedWithPendingCounter.status,
      finalStatus: confirmedWithPendingCounter.finalStatus,
      clientPriceStatus: confirmedWithPendingCounter.clientPriceStatus,
      agencyCounterPrice: confirmedWithPendingCounter.agencyCounterPrice,
      proposedPrice: confirmedWithPendingCounter.proposedPrice,
      modelApproval: confirmedWithPendingCounter.modelApproval,
      modelAccountLinked: confirmedWithPendingCounter.modelAccountLinked,
      isAgencyOnly: false,
      requestType: confirmedWithPendingCounter.requestType,
    };
    expect(clientMayConfirmJobFromSignals(signals)).toBe(false);
    expect(shouldShowClientAcceptCounterAction(confirmedWithPendingCounter)).toBe(true);
  });

  it('after counter accept, Confirm Job may show (status still confirmed)', () => {
    const afterAccept = {
      ...confirmedWithPendingCounter,
      clientPriceStatus: 'accepted' as const,
    };
    expect(shouldShowClientAcceptCounterAction(afterAccept)).toBe(false);
    const signals = {
      status: afterAccept.status,
      finalStatus: afterAccept.finalStatus,
      clientPriceStatus: afterAccept.clientPriceStatus,
      agencyCounterPrice: afterAccept.agencyCounterPrice,
      proposedPrice: afterAccept.proposedPrice,
      modelApproval: afterAccept.modelApproval,
      modelAccountLinked: afterAccept.modelAccountLinked,
      isAgencyOnly: false,
      requestType: afterAccept.requestType,
    };
    expect(clientMayConfirmJobFromSignals(signals)).toBe(true);
  });

  it('hides for agency viewer even with pending counter', () => {
    expect(
      shouldShowClientAcceptCounterAction({
        ...confirmedWithPendingCounter,
        isAgency: true,
      }),
    ).toBe(false);
  });

  it('hides for agency-only requests', () => {
    expect(
      shouldShowClientAcceptCounterAction({
        ...confirmedWithPendingCounter,
        isAgencyOnly: true,
      }),
    ).toBe(false);
  });

  it('still works when status=in_negotiation (legacy path)', () => {
    expect(
      shouldShowClientAcceptCounterAction({
        ...confirmedWithPendingCounter,
        status: 'in_negotiation',
      }),
    ).toBe(true);
  });

  it('hides when client_price_status is not pending', () => {
    expect(
      shouldShowClientAcceptCounterAction({
        ...confirmedWithPendingCounter,
        clientPriceStatus: 'accepted',
      }),
    ).toBe(false);
  });

  it('hides when no agency counter', () => {
    expect(
      shouldShowClientAcceptCounterAction({
        ...confirmedWithPendingCounter,
        agencyCounterPrice: null,
      }),
    ).toBe(false);
  });

  it('hides when terminal (job_confirmed)', () => {
    expect(
      shouldShowClientAcceptCounterAction({
        ...confirmedWithPendingCounter,
        finalStatus: 'job_confirmed',
      }),
    ).toBe(false);
  });
});

describe('isAgencyPriceNegotiationOpen', () => {
  it('is true when status=confirmed (price may still be open)', () => {
    expect(isAgencyPriceNegotiationOpen('confirmed')).toBe(true);
  });

  it('is true for in_negotiation', () => {
    expect(isAgencyPriceNegotiationOpen('in_negotiation')).toBe(true);
  });

  it('is false for terminal rejected', () => {
    expect(isAgencyPriceNegotiationOpen('rejected')).toBe(false);
  });
});

describe('header/footer parity — client counter after status=confirmed', () => {
  const signalInput = {
    status: 'confirmed',
    finalStatus: 'option_confirmed',
    clientPriceStatus: 'pending' as const,
    agencyCounterPrice: 2,
    proposedPrice: 1,
    modelApproval: 'approved' as const,
    modelAccountLinked: true,
    isAgencyOnly: false,
    requestType: 'option' as const,
  };

  it('header Action required matches footer accept counter visibility', () => {
    expect(deriveNegotiationAttention(signalInput)).toBe('waiting_for_client_response');
    const header = attentionHeaderLabelFromSignals(signalInput, 'client');
    expect(header).not.toBeNull();
    expect(shouldShowClientAcceptCounterAction({ isAgency: false, ...signalInput })).toBe(true);
  });
});

describe('axis decoupling — confirmed + pending counter', () => {
  const signalInput = {
    status: 'confirmed',
    finalStatus: 'option_confirmed',
    clientPriceStatus: 'pending' as const,
    agencyCounterPrice: 2,
    proposedPrice: 1,
    modelApproval: 'approved' as const,
    modelAccountLinked: true,
  };

  it('D1 requires client price action while D2 is fully_cleared until price settled', () => {
    expect(deriveNegotiationAttention(signalInput)).toBe('waiting_for_client_response');
    expect(deriveApprovalAttention(signalInput)).toBe('fully_cleared');
  });

  it('after price accept, D2 moves to job finalize without resetting availability', () => {
    const afterAccept = { ...signalInput, clientPriceStatus: 'accepted' as const };
    expect(deriveNegotiationAttention(afterAccept)).toBe('price_agreed');
    expect(deriveApprovalAttention(afterAccept)).toBe('waiting_for_client_to_finalize_job');
  });
});
