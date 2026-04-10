import {
  deriveSmartAttentionState,
  modelInboxRequiresModelConfirmation,
  modelInboxSortPriority,
  optionRequestNeedsMessagesTabAttention,
  smartAttentionVisibleForRole,
} from '../optionRequestAttention';

describe('optionRequestNeedsMessagesTabAttention', () => {
  it('is true for in_negotiation without terminal final_status', () => {
    expect(
      optionRequestNeedsMessagesTabAttention({ status: 'in_negotiation', finalStatus: 'option_pending' }),
    ).toBe(true);
  });

  it('is false when final_status implies Confirmed display (even if status still in_negotiation)', () => {
    expect(
      optionRequestNeedsMessagesTabAttention({ status: 'in_negotiation', finalStatus: 'option_confirmed' }),
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
      }),
    ).toBe('job_confirmation_pending');
  });

  it('returns waiting_for_model when agency accepted but model still pending (in_negotiation + option_confirmed)', () => {
    expect(
      deriveSmartAttentionState({
        status: 'in_negotiation',
        finalStatus: 'option_confirmed',
        clientPriceStatus: 'accepted',
        modelApproval: 'pending',
      }),
    ).toBe('waiting_for_model');
  });

  it('returns waiting_for_model for pending model approval', () => {
    expect(
      deriveSmartAttentionState({
        status: 'in_negotiation',
        finalStatus: 'option_pending',
        clientPriceStatus: 'accepted',
        modelApproval: 'pending',
      }),
    ).toBe('waiting_for_model');
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
});

describe('smartAttentionVisibleForRole', () => {
  it('shows waiting_for_agency only for agency role', () => {
    expect(smartAttentionVisibleForRole('waiting_for_agency', 'agency')).toBe(true);
    expect(smartAttentionVisibleForRole('waiting_for_agency', 'client')).toBe(false);
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
