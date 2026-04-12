import {
  deriveApprovalAttention,
  deriveNegotiationAttention,
  deriveSmartAttentionState,
  modelInboxRequiresModelConfirmation,
  modelInboxSortPriority,
  optionRequestNeedsMessagesTabAttention,
  priceCommerciallySettledForUi,
  smartAttentionVisibleForRole,
  type AttentionSignalInput,
} from '../optionRequestAttention';
import { attentionHeaderLabelFromSignals } from '../negotiationAttentionLabels';

describe('optionRequestNeedsMessagesTabAttention', () => {
  it('is true for in_negotiation without terminal final_status', () => {
    expect(
      optionRequestNeedsMessagesTabAttention({ status: 'in_negotiation', finalStatus: 'option_pending' }),
    ).toBe(true);
  });

  it('is true when price is agreed but agency has not confirmed availability (D2: waiting_for_agency_confirmation)', () => {
    // Decoupled: price agreed (D1 done) but agency hasn't confirmed availability →
    // D2 shows waiting_for_agency_confirmation → tab-dot is true.
    expect(
      optionRequestNeedsMessagesTabAttention({
        status: 'in_negotiation',
        finalStatus: 'option_pending',
        clientPriceStatus: 'accepted',
        proposedPrice: 100,
      }),
    ).toBe(true);
  });

  it('is true when option_confirmed (Option confirmed is an active state requiring finalization)', () => {
    expect(
      optionRequestNeedsMessagesTabAttention({ status: 'in_negotiation', finalStatus: 'option_confirmed' }),
    ).toBe(true);
  });

  it('is false when job_confirmed (fully terminal)', () => {
    expect(
      optionRequestNeedsMessagesTabAttention({ status: 'confirmed', finalStatus: 'job_confirmed' }),
    ).toBe(false);
  });

  it('is false for rejected', () => {
    expect(optionRequestNeedsMessagesTabAttention({ status: 'rejected', finalStatus: null })).toBe(false);
  });

  it('is false for job_confirmed', () => {
    expect(
      optionRequestNeedsMessagesTabAttention({ status: 'confirmed', finalStatus: 'job_confirmed' }),
    ).toBe(false);
  });

  it('is true for Draft display (unknown status)', () => {
    expect(optionRequestNeedsMessagesTabAttention({ status: 'weird', finalStatus: null })).toBe(true);
  });
});

describe('deriveSmartAttentionState', () => {
  it('returns job_confirmation_pending when option leg is done and status is confirmed (client must confirm job)', () => {
    expect(
      deriveSmartAttentionState({
        status: 'confirmed',
        finalStatus: 'option_confirmed',
        clientPriceStatus: 'accepted',
        modelApproval: 'approved',
        proposedPrice: 100,
      }),
    ).toBe('job_confirmation_pending');
  });

  it('returns waiting_for_model when agency accepted but model still pending (in_negotiation + option_confirmed, linked model)', () => {
    expect(
      deriveSmartAttentionState({
        status: 'in_negotiation',
        finalStatus: 'option_confirmed',
        clientPriceStatus: 'accepted',
        modelApproval: 'pending',
        modelAccountLinked: true,
        proposedPrice: 100,
      }),
    ).toBe('waiting_for_model');
  });

  it('returns job_confirmation_pending when option_confirmed but model not linked (no-account branch)', () => {
    expect(
      deriveSmartAttentionState({
        status: 'in_negotiation',
        finalStatus: 'option_confirmed',
        clientPriceStatus: 'accepted',
        modelApproval: 'pending',
        proposedPrice: 100,
      }),
    ).toBe('job_confirmation_pending');
  });

  it('returns waiting_for_agency when price settled but agency has not confirmed (D2 decoupled)', () => {
    // Decoupled: price settled + agency not yet confirmed → waiting_for_agency_confirmation → maps to waiting_for_agency
    expect(
      deriveSmartAttentionState({
        status: 'in_negotiation',
        finalStatus: 'option_pending',
        clientPriceStatus: 'accepted',
        modelApproval: 'pending',
        modelAccountLinked: true,
        proposedPrice: 100,
      }),
    ).toBe('waiting_for_agency');
  });

  it('returns waiting_for_agency when price settled and model not linked but agency has not confirmed', () => {
    // Decoupled: price axis done, availability axis pending (agency must confirm)
    expect(
      deriveSmartAttentionState({
        status: 'in_negotiation',
        finalStatus: 'option_pending',
        clientPriceStatus: 'accepted',
        modelApproval: 'pending',
        proposedPrice: 100,
      }),
    ).toBe('waiting_for_agency');
  });

  it('returns counter_pending when client rejected agency terms', () => {
    expect(
      deriveSmartAttentionState({
        status: 'in_negotiation',
        finalStatus: 'option_pending',
        clientPriceStatus: 'rejected',
        modelApproval: 'approved',
      }),
    ).toBe('counter_pending');
  });

  it('does not surface counter_pending when status is rejected (terminal row) even if client_price_status is rejected', () => {
    expect(
      deriveSmartAttentionState({
        status: 'rejected',
        finalStatus: 'option_pending',
        clientPriceStatus: 'rejected',
        modelApproval: 'approved',
      }),
    ).toBe('no_attention');
  });

  it('maps agency counter pending to waiting_for_client (not agency)', () => {
    expect(
      deriveSmartAttentionState({
        status: 'in_negotiation',
        finalStatus: 'option_pending',
        clientPriceStatus: 'pending',
        agencyCounterPrice: 500,
        proposedPrice: 400,
        modelApproval: 'approved',
      }),
    ).toBe('waiting_for_client');
  });
});

describe('deriveNegotiationAttention', () => {
  it('returns waiting_for_client_response when agency has countered', () => {
    expect(
      deriveNegotiationAttention({
        status: 'in_negotiation',
        finalStatus: 'option_pending',
        clientPriceStatus: 'pending',
        agencyCounterPrice: 999,
        proposedPrice: 100,
      }),
    ).toBe('waiting_for_client_response');
  });

  it('does not return price_agreed when accepted in DB but no commercial anchor (aligns with footer lock)', () => {
    expect(
      deriveNegotiationAttention({
        status: 'in_negotiation',
        finalStatus: 'option_pending',
        clientPriceStatus: 'accepted',
        proposedPrice: null,
        agencyCounterPrice: null,
      }),
    ).toBe('negotiation_open');
  });
});

describe('deriveApprovalAttention', () => {
  it('returns waiting_for_model_confirmation when agency confirmed, even without commercial anchor (D2 decoupled from D1)', () => {
    // Decoupled: D2 checks availability independently of price settlement.
    // Agency confirmed (final_status = option_confirmed) + model pending → waiting_for_model.
    expect(
      deriveApprovalAttention({
        status: 'in_negotiation',
        finalStatus: 'option_confirmed',
        clientPriceStatus: 'accepted',
        proposedPrice: null,
        agencyCounterPrice: null,
        modelApproval: 'pending',
        modelAccountLinked: true,
      }),
    ).toBe('waiting_for_model_confirmation');
  });

  it('returns waiting_for_model_confirmation when price is commercially settled and model must confirm', () => {
    expect(
      deriveApprovalAttention({
        status: 'in_negotiation',
        finalStatus: 'option_confirmed',
        clientPriceStatus: 'accepted',
        proposedPrice: 500,
        modelApproval: 'pending',
        modelAccountLinked: true,
      }),
    ).toBe('waiting_for_model_confirmation');
  });
});

describe('priceCommerciallySettledForUi', () => {
  it('is true when accepted and proposed price exists', () => {
    expect(
      priceCommerciallySettledForUi({
        status: 'in_negotiation',
        clientPriceStatus: 'accepted',
        proposedPrice: 100,
      }),
    ).toBe(true);
  });

  it('is true when accepted and agency counter exists', () => {
    expect(
      priceCommerciallySettledForUi({
        status: 'in_negotiation',
        clientPriceStatus: 'accepted',
        agencyCounterPrice: 200,
      }),
    ).toBe(true);
  });

  it('is false when accepted but no price anchors', () => {
    expect(
      priceCommerciallySettledForUi({
        status: 'in_negotiation',
        clientPriceStatus: 'accepted',
        proposedPrice: null,
        agencyCounterPrice: null,
      }),
    ).toBe(false);
  });
});

describe('smartAttentionVisibleForRole', () => {
  it('shows waiting_for_agency for agency AND client (client sees "Waiting for agency")', () => {
    expect(smartAttentionVisibleForRole('waiting_for_agency', 'agency')).toBe(true);
    expect(smartAttentionVisibleForRole('waiting_for_agency', 'client')).toBe(true);
  });

  it('hides waiting_for_model for model role (client/agency attention only)', () => {
    expect(smartAttentionVisibleForRole('waiting_for_model', 'model')).toBe(false);
    expect(smartAttentionVisibleForRole('waiting_for_model', 'agency')).toBe(true);
    expect(smartAttentionVisibleForRole('waiting_for_model', 'client')).toBe(true);
  });

  it('hides no_attention for all roles', () => {
    expect(smartAttentionVisibleForRole('no_attention', 'agency')).toBe(false);
    expect(smartAttentionVisibleForRole('no_attention', 'client')).toBe(false);
    expect(smartAttentionVisibleForRole('no_attention', 'model')).toBe(false);
  });
});

describe('modelInboxRequiresModelConfirmation', () => {
  it('is true when agency accepted and linked model must confirm', () => {
    expect(
      modelInboxRequiresModelConfirmation({
        status: 'in_negotiation',
        finalStatus: 'option_confirmed',
        modelApproval: 'pending',
        modelAccountLinked: true,
      }),
    ).toBe(true);
  });

  it('is false when model has no account', () => {
    expect(
      modelInboxRequiresModelConfirmation({
        status: 'in_negotiation',
        finalStatus: 'option_confirmed',
        modelApproval: 'pending',
        modelAccountLinked: false,
      }),
    ).toBe(false);
  });

  it('is false when model already approved', () => {
    expect(
      modelInboxRequiresModelConfirmation({
        status: 'confirmed',
        finalStatus: 'option_confirmed',
        modelApproval: 'approved',
        modelAccountLinked: true,
      }),
    ).toBe(false);
  });
});

describe('modelInboxSortPriority', () => {
  it('ranks must-confirm rows first', () => {
    const mustConfirm = modelInboxSortPriority({
      status: 'in_negotiation',
      finalStatus: 'option_confirmed',
      modelApproval: 'pending',
      modelAccountLinked: true,
    });
    const otherPending = modelInboxSortPriority({
      status: 'in_negotiation',
      finalStatus: 'option_pending',
      modelApproval: 'pending',
      modelAccountLinked: true,
    });
    expect(mustConfirm).toBeLessThan(otherPending);
  });
});

/**
 * Adversarial: action-priority — when BOTH axes are active, the role that
 * must act sees "Action required", not a passive "Waiting for X" label.
 */
describe('attentionHeaderLabelFromSignals — action-priority across all roles', () => {
  const actionLabel = 'Action required';

  // State 7: Agency confirmed availability, model pending, price NOT settled
  const bothAxesActive: AttentionSignalInput = {
    status: 'in_negotiation',
    finalStatus: 'option_confirmed',
    clientPriceStatus: 'pending',
    proposedPrice: 100,
    agencyCounterPrice: null,
    modelApproval: 'pending',
    modelAccountLinked: true,
  };

  it('agency sees "Action required" when D1 price action AND D2 model waiting', () => {
    const label = attentionHeaderLabelFromSignals(bothAxesActive, 'agency');
    expect(label).toBe(actionLabel);
  });

  it('client sees "Waiting for model" (D2 waiting) — no actionable signal for client', () => {
    const label = attentionHeaderLabelFromSignals(bothAxesActive, 'client');
    expect(label).toContain('model');
    expect(label).not.toBe(actionLabel);
  });

  // Price settled but agency hasn't confirmed availability
  const priceSettledNoAvailability: AttentionSignalInput = {
    status: 'in_negotiation',
    finalStatus: 'option_pending',
    clientPriceStatus: 'accepted',
    proposedPrice: 100,
    modelApproval: 'pending',
    modelAccountLinked: true,
  };

  it('agency sees "Action required" when price is settled but availability unconfirmed', () => {
    const label = attentionHeaderLabelFromSignals(priceSettledNoAvailability, 'agency');
    expect(label).toBe(actionLabel);
  });

  it('client sees "Waiting for agency" when price is settled but availability unconfirmed', () => {
    const label = attentionHeaderLabelFromSignals(priceSettledNoAvailability, 'client');
    expect(label).not.toBe(actionLabel);
    expect(label).toBeTruthy();
  });

  // Both done, client must confirm job
  const jobReady: AttentionSignalInput = {
    status: 'in_negotiation',
    finalStatus: 'option_confirmed',
    clientPriceStatus: 'accepted',
    proposedPrice: 100,
    modelApproval: 'approved',
    modelAccountLinked: true,
  };

  it('client sees "Action required" when both axes done (confirm job)', () => {
    expect(attentionHeaderLabelFromSignals(jobReady, 'client')).toBe(actionLabel);
  });

  it('agency sees null when both axes done (nothing for agency to do)', () => {
    expect(attentionHeaderLabelFromSignals(jobReady, 'agency')).toBeNull();
  });

  // Tab dot must agree with header for client
  it('tab dot agrees with header for all states', () => {
    const states: AttentionSignalInput[] = [
      bothAxesActive,
      priceSettledNoAvailability,
      jobReady,
      { status: 'rejected', finalStatus: null },
      { status: 'confirmed', finalStatus: 'job_confirmed' },
      { status: 'in_negotiation', finalStatus: 'option_pending', clientPriceStatus: 'pending', proposedPrice: 100 },
    ];
    for (const s of states) {
      const headerNonNull = attentionHeaderLabelFromSignals(s, 'client') !== null;
      const tabDot = optionRequestNeedsMessagesTabAttention({
        status: s.status,
        finalStatus: s.finalStatus,
        clientPriceStatus: s.clientPriceStatus,
        modelApproval: s.modelApproval,
        modelAccountLinked: s.modelAccountLinked,
        agencyCounterPrice: s.agencyCounterPrice,
        proposedPrice: s.proposedPrice,
      });
      expect(tabDot).toBe(headerNonNull);
    }
  });
});
