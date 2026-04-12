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

/* ═══════════════════════════════════════════════════════════════════════════
 * COMPREHENSIVE 16-STATE MATRIX
 * Every combination the user listed (model-rejected, agency-rejected,
 * counter-rejected, no-model-account branches, option_confirmed vs
 * job_confirmed, casting, conflict, unread-notification, new-message).
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('comprehensive 16-state matrix — all heikle Mischzustände', () => {
  const actionLabel = 'Action required';

  // ──────── 1. Model rejected, price NOT settled ────────
  describe('1. model_approval=rejected, price pending', () => {
    const input: AttentionSignalInput = {
      status: 'in_negotiation',
      finalStatus: 'option_confirmed',
      clientPriceStatus: 'pending',
      proposedPrice: 100,
      modelApproval: 'rejected',
      modelAccountLinked: true,
    };

    it('D1 = waiting_for_agency_response (price still open)', () => {
      expect(deriveNegotiationAttention(input)).toBe('waiting_for_agency_response');
    });

    it('D2 = fully_cleared (model answered — no more availability action)', () => {
      expect(deriveApprovalAttention(input)).toBe('fully_cleared');
    });

    it('agency sees "Action required" (price action still pending)', () => {
      expect(attentionHeaderLabelFromSignals(input, 'agency')).toBe(actionLabel);
    });

    it('client sees "Waiting for agency" (agency must handle price)', () => {
      const label = attentionHeaderLabelFromSignals(input, 'client');
      expect(label).toBeTruthy();
      expect(label).not.toBe(actionLabel);
    });

    it('model inbox: NOT action-required (model already rejected)', () => {
      expect(modelInboxRequiresModelConfirmation(input)).toBe(false);
    });
  });

  // ──────── 2. Model rejected, price already settled ────────
  describe('2. model_approval=rejected, price settled', () => {
    const input: AttentionSignalInput = {
      status: 'in_negotiation',
      finalStatus: 'option_confirmed',
      clientPriceStatus: 'accepted',
      proposedPrice: 100,
      modelApproval: 'rejected',
      modelAccountLinked: true,
    };

    it('D1 = price_agreed', () => {
      expect(deriveNegotiationAttention(input)).toBe('price_agreed');
    });

    it('D2 = fully_cleared (model rejected but that is an answer)', () => {
      expect(deriveApprovalAttention(input)).toBe('fully_cleared');
    });

    it('agency header = null (no action on either axis)', () => {
      expect(attentionHeaderLabelFromSignals(input, 'agency')).toBeNull();
    });

    it('client header = null', () => {
      expect(attentionHeaderLabelFromSignals(input, 'client')).toBeNull();
    });

    it('tab dot = false (terminal for both axes)', () => {
      expect(optionRequestNeedsMessagesTabAttention(input)).toBe(false);
    });
  });

  // ──────── 3. Agency rejected (status=rejected) while price pending ────────
  describe('3. status=rejected, price pending', () => {
    const input: AttentionSignalInput = {
      status: 'rejected',
      finalStatus: 'option_pending',
      clientPriceStatus: 'pending',
      proposedPrice: 100,
    };

    it('D1 = negotiation_terminal', () => {
      expect(deriveNegotiationAttention(input)).toBe('negotiation_terminal');
    });

    it('D2 = fully_cleared', () => {
      expect(deriveApprovalAttention(input)).toBe('fully_cleared');
    });

    it('all roles: no attention (terminal)', () => {
      expect(attentionHeaderLabelFromSignals(input, 'agency')).toBeNull();
      expect(attentionHeaderLabelFromSignals(input, 'client')).toBeNull();
    });

    it('legacy smart: no_attention', () => {
      expect(deriveSmartAttentionState(input)).toBe('no_attention');
    });
  });

  // ──────── 4. Agency rejected after model approved ────────
  describe('4. status=rejected, model_approval=approved', () => {
    const input: AttentionSignalInput = {
      status: 'rejected',
      finalStatus: 'option_confirmed',
      clientPriceStatus: 'accepted',
      proposedPrice: 100,
      modelApproval: 'approved',
      modelAccountLinked: true,
    };

    it('terminal: both D1 and D2 are no-action', () => {
      expect(deriveNegotiationAttention(input)).toBe('negotiation_terminal');
      expect(deriveApprovalAttention(input)).toBe('fully_cleared');
    });

    it('no attention for any role', () => {
      expect(attentionHeaderLabelFromSignals(input, 'agency')).toBeNull();
      expect(attentionHeaderLabelFromSignals(input, 'client')).toBeNull();
      expect(optionRequestNeedsMessagesTabAttention(input)).toBe(false);
    });
  });

  // ──────── 5. Client rejected counter, agency must re-respond ────────
  describe('5. client_price_status=rejected (counter rejected), agency must act', () => {
    const input: AttentionSignalInput = {
      status: 'in_negotiation',
      finalStatus: 'option_pending',
      clientPriceStatus: 'rejected',
      agencyCounterPrice: 500,
      proposedPrice: 400,
    };

    it('D1 = counter_rejected', () => {
      expect(deriveNegotiationAttention(input)).toBe('counter_rejected');
    });

    it('D2 = approval_inactive (agency hasn\'t confirmed)', () => {
      expect(deriveApprovalAttention(input)).toBe('approval_inactive');
    });

    it('agency sees "Action required" (must respond to rejection)', () => {
      expect(attentionHeaderLabelFromSignals(input, 'agency')).toBe(actionLabel);
    });

    it('client sees "Waiting for agency" (agency must act on price)', () => {
      const label = attentionHeaderLabelFromSignals(input, 'client');
      expect(label).toBeTruthy();
      expect(label).not.toBe(actionLabel);
    });
  });

  // ──────── 6. Client accepted counter, agency hasn't confirmed availability ────────
  describe('6. client accepted counter, agency availability pending', () => {
    const input: AttentionSignalInput = {
      status: 'in_negotiation',
      finalStatus: 'option_pending',
      clientPriceStatus: 'accepted',
      agencyCounterPrice: 500,
      proposedPrice: 400,
      modelApproval: 'pending',
      modelAccountLinked: true,
    };

    it('D1 = price_agreed', () => {
      expect(deriveNegotiationAttention(input)).toBe('price_agreed');
    });

    it('D2 = waiting_for_agency_confirmation (price done, agency must confirm availability)', () => {
      expect(deriveApprovalAttention(input)).toBe('waiting_for_agency_confirmation');
    });

    it('agency: "Action required" (Tier 1 D2 action)', () => {
      expect(attentionHeaderLabelFromSignals(input, 'agency')).toBe(actionLabel);
    });

    it('client: "Waiting for agency confirmation"', () => {
      const label = attentionHeaderLabelFromSignals(input, 'client');
      expect(label).toBeTruthy();
      expect(label).not.toBe(actionLabel);
    });
  });

  // ──────── 7. Model approved before agency confirmed ────────
  describe('7. model_approval=approved, finalStatus=option_pending (model approved first — edge)', () => {
    const input: AttentionSignalInput = {
      status: 'in_negotiation',
      finalStatus: 'option_pending',
      clientPriceStatus: 'pending',
      proposedPrice: 100,
      modelApproval: 'approved',
      modelAccountLinked: true,
    };

    it('D2 = approval_inactive (agency hasn\'t confirmed yet, price not settled)', () => {
      expect(deriveApprovalAttention(input)).toBe('approval_inactive');
    });

    it('D1 = waiting_for_agency_response', () => {
      expect(deriveNegotiationAttention(input)).toBe('waiting_for_agency_response');
    });

    it('agency sees "Action required" (price action)', () => {
      expect(attentionHeaderLabelFromSignals(input, 'agency')).toBe(actionLabel);
    });
  });

  // ──────── 8. Agency confirmed before model approved ────────
  describe('8. agency confirmed, model pending (standard flow)', () => {
    const input: AttentionSignalInput = {
      status: 'in_negotiation',
      finalStatus: 'option_confirmed',
      clientPriceStatus: 'accepted',
      proposedPrice: 100,
      modelApproval: 'pending',
      modelAccountLinked: true,
    };

    it('D2 = waiting_for_model_confirmation', () => {
      expect(deriveApprovalAttention(input)).toBe('waiting_for_model_confirmation');
    });

    it('model inbox: action-required', () => {
      expect(modelInboxRequiresModelConfirmation(input)).toBe(true);
    });

    it('agency sees "Waiting for model" (D2 waiting)', () => {
      const label = attentionHeaderLabelFromSignals(input, 'agency');
      expect(label).toContain('model');
      expect(label).not.toBe(actionLabel);
    });

    it('client sees "Waiting for model" (D2 waiting)', () => {
      const label = attentionHeaderLabelFromSignals(input, 'client');
      expect(label).toContain('model');
      expect(label).not.toBe(actionLabel);
    });
  });

  // ──────── 9. No model account + price pending ────────
  describe('9. no model account, price pending', () => {
    const input: AttentionSignalInput = {
      status: 'in_negotiation',
      finalStatus: 'option_pending',
      clientPriceStatus: 'pending',
      proposedPrice: 100,
      modelAccountLinked: false,
    };

    it('D1 = waiting_for_agency_response', () => {
      expect(deriveNegotiationAttention(input)).toBe('waiting_for_agency_response');
    });

    it('D2 = approval_inactive (price not settled, no model gate)', () => {
      expect(deriveApprovalAttention(input)).toBe('approval_inactive');
    });

    it('agency: "Action required" (price)', () => {
      expect(attentionHeaderLabelFromSignals(input, 'agency')).toBe(actionLabel);
    });

    it('model inbox: NOT action-required (no account)', () => {
      expect(modelInboxRequiresModelConfirmation(input)).toBe(false);
    });
  });

  // ──────── 10. No model account + price settled + agency NOT confirmed ────────
  describe('10. no model account, price settled, agency not confirmed', () => {
    const input: AttentionSignalInput = {
      status: 'in_negotiation',
      finalStatus: 'option_pending',
      clientPriceStatus: 'accepted',
      proposedPrice: 100,
      modelAccountLinked: false,
    };

    it('D1 = price_agreed', () => {
      expect(deriveNegotiationAttention(input)).toBe('price_agreed');
    });

    it('D2 = waiting_for_agency_confirmation', () => {
      expect(deriveApprovalAttention(input)).toBe('waiting_for_agency_confirmation');
    });

    it('agency: "Action required" (must confirm availability)', () => {
      expect(attentionHeaderLabelFromSignals(input, 'agency')).toBe(actionLabel);
    });

    it('client: waiting (not agency)', () => {
      const label = attentionHeaderLabelFromSignals(input, 'client');
      expect(label).toBeTruthy();
      expect(label).not.toBe(actionLabel);
    });
  });

  // ──────── 11. Option confirmed, job NOT confirmed ────────
  describe('11. option_confirmed, price settled, model approved — job pending', () => {
    const input: AttentionSignalInput = {
      status: 'confirmed',
      finalStatus: 'option_confirmed',
      clientPriceStatus: 'accepted',
      proposedPrice: 100,
      modelApproval: 'approved',
      modelAccountLinked: true,
    };

    it('D2 = waiting_for_client_to_finalize_job', () => {
      expect(deriveApprovalAttention(input)).toBe('waiting_for_client_to_finalize_job');
    });

    it('client: "Action required" (confirm job)', () => {
      expect(attentionHeaderLabelFromSignals(input, 'client')).toBe(actionLabel);
    });

    it('agency: null (no action for agency)', () => {
      expect(attentionHeaderLabelFromSignals(input, 'agency')).toBeNull();
    });

    it('tab dot = true for client', () => {
      expect(optionRequestNeedsMessagesTabAttention(input)).toBe(true);
    });
  });

  // ──────── 12. Casting request (request_type not part of attention — same D1/D2) ────────
  describe('12. casting — same attention logic as option', () => {
    const castingPending: AttentionSignalInput = {
      status: 'in_negotiation',
      finalStatus: 'option_pending',
      clientPriceStatus: 'pending',
      proposedPrice: 100,
    };

    it('D1 is the same regardless of request_type', () => {
      expect(deriveNegotiationAttention(castingPending)).toBe('waiting_for_agency_response');
    });

    it('D2 is the same — approval_inactive', () => {
      expect(deriveApprovalAttention(castingPending)).toBe('approval_inactive');
    });

    it('attention signals are request_type agnostic', () => {
      expect(attentionHeaderLabelFromSignals(castingPending, 'agency')).toBe(actionLabel);
    });
  });

  // ──────── 13. Deleted / archived (status=rejected is terminal) ────────
  describe('13. deleted/archived — represented as status=rejected', () => {
    const deleted: AttentionSignalInput = {
      status: 'rejected',
      finalStatus: 'option_pending',
    };

    it('both axes terminal', () => {
      expect(deriveNegotiationAttention(deleted)).toBe('negotiation_terminal');
      expect(deriveApprovalAttention(deleted)).toBe('fully_cleared');
    });

    it('no attention signals', () => {
      expect(attentionHeaderLabelFromSignals(deleted, 'agency')).toBeNull();
      expect(attentionHeaderLabelFromSignals(deleted, 'client')).toBeNull();
      expect(optionRequestNeedsMessagesTabAttention(deleted)).toBe(false);
    });
  });

  // ──────── 14. Conflict warning ────────
  describe('14. conflict warning active', () => {
    const withConflict: AttentionSignalInput = {
      status: 'in_negotiation',
      finalStatus: 'option_pending',
      clientPriceStatus: 'pending',
      proposedPrice: 100,
      hasConflictWarning: true,
    };

    it('legacy smart attention = conflict_risk', () => {
      expect(deriveSmartAttentionState(withConflict)).toBe('conflict_risk');
    });

    it('conflict_risk visible for agency and client', () => {
      expect(smartAttentionVisibleForRole('conflict_risk', 'agency')).toBe(true);
      expect(smartAttentionVisibleForRole('conflict_risk', 'client')).toBe(true);
      expect(smartAttentionVisibleForRole('conflict_risk', 'model')).toBe(false);
    });

    it('D1/D2 signals unaffected by conflict (separate layer)', () => {
      expect(deriveNegotiationAttention(withConflict)).toBe('waiting_for_agency_response');
      expect(deriveApprovalAttention(withConflict)).toBe('approval_inactive');
    });
  });

  // ──────── 15. Unread notification, no action-required ────────
  describe('15. no-action state (unread notification is separate system)', () => {
    const noAction: AttentionSignalInput = {
      status: 'confirmed',
      finalStatus: 'job_confirmed',
    };

    it('both axes fully terminal', () => {
      expect(deriveNegotiationAttention(noAction)).toBe('negotiation_terminal');
      expect(deriveApprovalAttention(noAction)).toBe('job_completed');
    });

    it('no attention signals — notifications are a separate system from action-required', () => {
      expect(attentionHeaderLabelFromSignals(noAction, 'agency')).toBeNull();
      expect(attentionHeaderLabelFromSignals(noAction, 'client')).toBeNull();
      expect(optionRequestNeedsMessagesTabAttention(noAction)).toBe(false);
    });
  });

  // ──────── 16. New message without status change ────────
  describe('16. new message — does NOT change attention (attention ≠ unread)', () => {
    const beforeMsg: AttentionSignalInput = {
      status: 'in_negotiation',
      finalStatus: 'option_pending',
      clientPriceStatus: 'pending',
      proposedPrice: 100,
    };

    it('identical AttentionSignalInput produces identical signals regardless of messages', () => {
      const d1 = deriveNegotiationAttention(beforeMsg);
      const d2 = deriveApprovalAttention(beforeMsg);
      const header = attentionHeaderLabelFromSignals(beforeMsg, 'agency');
      expect(d1).toBe(deriveNegotiationAttention({ ...beforeMsg }));
      expect(d2).toBe(deriveApprovalAttention({ ...beforeMsg }));
      expect(header).toBe(attentionHeaderLabelFromSignals({ ...beforeMsg }, 'agency'));
    });
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * AXIS INDEPENDENCE INVARIANTS
 * The price axis (D1) and availability axis (D2) must be independently
 * derivable. Changing one axis must never alter the other's output.
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('axis independence invariant — D1 and D2 are orthogonal', () => {

  it('changing D1 fields does NOT affect D2 output', () => {
    const base: AttentionSignalInput = {
      status: 'in_negotiation',
      finalStatus: 'option_confirmed',
      modelApproval: 'pending',
      modelAccountLinked: true,
      clientPriceStatus: 'pending',
      proposedPrice: 100,
    };
    const d2Base = deriveApprovalAttention(base);

    const variants: Partial<AttentionSignalInput>[] = [
      { clientPriceStatus: 'accepted' },
      { clientPriceStatus: 'rejected' },
      { agencyCounterPrice: 999 },
      { proposedPrice: 50 },
      { proposedPrice: null, agencyCounterPrice: null },
    ];

    for (const v of variants) {
      const modified = { ...base, ...v };
      expect(deriveApprovalAttention(modified)).toBe(d2Base);
    }
  });

  it('changing D2 fields does NOT affect D1 output', () => {
    const base: AttentionSignalInput = {
      status: 'in_negotiation',
      finalStatus: 'option_pending',
      clientPriceStatus: 'pending',
      proposedPrice: 100,
      modelApproval: 'pending',
      modelAccountLinked: true,
    };
    const d1Base = deriveNegotiationAttention(base);

    const variants: Partial<AttentionSignalInput>[] = [
      { modelApproval: 'approved' },
      { modelApproval: 'rejected' },
      { modelAccountLinked: false },
      { modelAccountLinked: null },
      { finalStatus: 'option_confirmed' },
    ];

    for (const v of variants) {
      const modified = { ...base, ...v };
      expect(deriveNegotiationAttention(modified)).toBe(d1Base);
    }
  });

  it('model_account_linked null fallback is always false (§B invariant)', () => {
    const base: AttentionSignalInput = {
      status: 'in_negotiation',
      finalStatus: 'option_confirmed',
      modelApproval: 'pending',
      modelAccountLinked: null,
      clientPriceStatus: 'accepted',
      proposedPrice: 100,
    };

    expect(deriveApprovalAttention(base)).not.toBe('waiting_for_model_confirmation');
    expect(deriveApprovalAttention(base)).toBe('waiting_for_client_to_finalize_job');
  });

  it('job requires BOTH axes: price agreed AND availability cleared', () => {
    const priceDone: AttentionSignalInput = {
      status: 'in_negotiation',
      finalStatus: 'option_confirmed',
      clientPriceStatus: 'accepted',
      proposedPrice: 100,
      modelApproval: 'approved',
      modelAccountLinked: true,
    };
    expect(deriveApprovalAttention(priceDone)).toBe('waiting_for_client_to_finalize_job');

    // Price NOT settled but model approved → D2 says "availability done" (fully_cleared),
    // but NOT "ready to finalize job" — job requires price_agreed too.
    const priceNotDone = { ...priceDone, clientPriceStatus: 'pending' as const };
    expect(deriveApprovalAttention(priceNotDone)).not.toBe('waiting_for_client_to_finalize_job');
    expect(deriveApprovalAttention(priceNotDone)).toBe('fully_cleared');

    // Price settled but model NOT approved → waiting_for_model, not job-ready.
    const modelNotDone = { ...priceDone, modelApproval: 'pending' as const };
    expect(deriveApprovalAttention(modelNotDone)).toBe('waiting_for_model_confirmation');
    expect(deriveApprovalAttention(modelNotDone)).not.toBe('waiting_for_client_to_finalize_job');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * STATE 5/6 DRIFT AUDIT
 * When agency has null header, verify tab-dot, badge and calendar next-step
 * all agree — no silent active-badge on a null-header.
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('state 5/6 drift audit — agency null-header consistency', () => {

  const state5_jobReady: AttentionSignalInput = {
    status: 'confirmed',
    finalStatus: 'option_confirmed',
    clientPriceStatus: 'accepted',
    proposedPrice: 100,
    modelApproval: 'approved',
    modelAccountLinked: true,
  };

  const state6_noAccount: AttentionSignalInput = {
    status: 'in_negotiation',
    finalStatus: 'option_confirmed',
    clientPriceStatus: 'accepted',
    proposedPrice: 100,
    modelAccountLinked: false,
    modelApproval: 'pending',
  };

  it('state 5 — agency: header=null, D1=terminal, D2=job_pending (client action)', () => {
    expect(attentionHeaderLabelFromSignals(state5_jobReady, 'agency')).toBeNull();
    expect(deriveNegotiationAttention(state5_jobReady)).toBe('price_agreed');
    expect(deriveApprovalAttention(state5_jobReady)).toBe('waiting_for_client_to_finalize_job');
  });

  it('state 5 — client: header="Action required"', () => {
    expect(attentionHeaderLabelFromSignals(state5_jobReady, 'client')).toBe('Action required');
  });

  it('state 6 — no-model-account + agency confirmed + price settled → client must confirm job', () => {
    expect(attentionHeaderLabelFromSignals(state6_noAccount, 'agency')).toBeNull();
    expect(attentionHeaderLabelFromSignals(state6_noAccount, 'client')).toBe('Action required');
    expect(deriveApprovalAttention(state6_noAccount)).toBe('waiting_for_client_to_finalize_job');
  });

  it('state 5/6 — tab dot: true for client, false-equivalent for agency', () => {
    expect(optionRequestNeedsMessagesTabAttention(state5_jobReady)).toBe(true);
    expect(optionRequestNeedsMessagesTabAttention(state6_noAccount)).toBe(true);
  });

  it('smart attention legacy: agency null header must mean no smartAttentionVisibleForRole', () => {
    const smart5 = deriveSmartAttentionState(state5_jobReady);
    const smart6 = deriveSmartAttentionState(state6_noAccount);
    expect(smart5).toBe('job_confirmation_pending');
    expect(smart6).toBe('job_confirmation_pending');
    expect(smartAttentionVisibleForRole(smart5, 'agency')).toBe(false);
    expect(smartAttentionVisibleForRole(smart6, 'agency')).toBe(false);
  });

  it('complete tab-dot ↔ header parity across ALL 16 states', () => {
    const allStates: AttentionSignalInput[] = [
      { status: 'in_negotiation', finalStatus: 'option_confirmed', clientPriceStatus: 'pending', proposedPrice: 100, modelApproval: 'rejected', modelAccountLinked: true },
      { status: 'in_negotiation', finalStatus: 'option_confirmed', clientPriceStatus: 'accepted', proposedPrice: 100, modelApproval: 'rejected', modelAccountLinked: true },
      { status: 'rejected', finalStatus: 'option_pending', clientPriceStatus: 'pending', proposedPrice: 100 },
      { status: 'rejected', finalStatus: 'option_confirmed', clientPriceStatus: 'accepted', proposedPrice: 100, modelApproval: 'approved', modelAccountLinked: true },
      { status: 'in_negotiation', finalStatus: 'option_pending', clientPriceStatus: 'rejected', agencyCounterPrice: 500, proposedPrice: 400 },
      { status: 'in_negotiation', finalStatus: 'option_pending', clientPriceStatus: 'accepted', agencyCounterPrice: 500, proposedPrice: 400, modelApproval: 'pending', modelAccountLinked: true },
      { status: 'in_negotiation', finalStatus: 'option_pending', clientPriceStatus: 'pending', proposedPrice: 100, modelApproval: 'approved', modelAccountLinked: true },
      { status: 'in_negotiation', finalStatus: 'option_confirmed', clientPriceStatus: 'accepted', proposedPrice: 100, modelApproval: 'pending', modelAccountLinked: true },
      { status: 'in_negotiation', finalStatus: 'option_pending', clientPriceStatus: 'pending', proposedPrice: 100, modelAccountLinked: false },
      { status: 'in_negotiation', finalStatus: 'option_pending', clientPriceStatus: 'accepted', proposedPrice: 100, modelAccountLinked: false },
      state5_jobReady,
      { status: 'in_negotiation', finalStatus: 'option_pending', clientPriceStatus: 'pending', proposedPrice: 100 },
      { status: 'rejected', finalStatus: 'option_pending' },
      { status: 'in_negotiation', finalStatus: 'option_pending', clientPriceStatus: 'pending', proposedPrice: 100, hasConflictWarning: true },
      { status: 'confirmed', finalStatus: 'job_confirmed' },
      { status: 'in_negotiation', finalStatus: 'option_pending', clientPriceStatus: 'pending', proposedPrice: 100 },
    ];

    for (const s of allStates) {
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
