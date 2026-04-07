/**
 * Tests for gdprComplianceSupabase.ts
 *
 * Covers launch-critical compliance + security controls:
 *   1. confirmImageRights      — inserts record, returns confirmationId, blocks on DB error
 *   2. hasRecentImageRightsConfirmation — time-window guard (model-scoped)
 *   3. hasRecentImageRightsForSessionKey — time-window guard (session-scoped)
 *   4. guardUploadSession      — blocks upload if no recent confirmation
 *   5. logAuditAction          — fires log_audit_action RPC, fire-and-forget safe
 *   6. logBookingAction        — correct action type and entity forwarded
 *   7. logOptionAction         — correct action type and entity forwarded
 *   8. deleteOrganizationData  — owner-only enforcement, error propagation
 */

jest.mock('../../../lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
    rpc:  jest.fn(),
    auth: {
      getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }),
    },
  },
}));

import { supabase } from '../../../lib/supabase';
import {
  confirmImageRights,
  hasRecentImageRightsConfirmation,
  hasRecentImageRightsForSessionKey,
  guardUploadSession,
  logAuditAction,
  logBookingAction,
  logOptionAction,
  deleteOrganizationData,
} from '../gdprComplianceSupabase';

const from = supabase.from as jest.Mock;
const rpc  = supabase.rpc  as jest.Mock;

/**
 * Chainable Supabase query mock.
 *
 * Terminal calls:
 *   .maybeSingle() / .single() → Promise<result>
 *   .insert()                  → Promise<result> (direct-await pattern, no .single())
 *
 * All other calls (select, eq, gte, limit, …) return the same chain for further chaining.
 */
const makeChain = (result: unknown) => {
  const chain: Record<string, jest.Mock> = {};
  ['insert', 'select', 'update', 'upsert', 'eq', 'neq', 'gte', 'lte', 'limit', 'order', 'is', 'maybeSingle', 'single'].forEach((m) => {
    chain[m] = jest.fn(() => {
      // Terminal resolution: direct-await insert (no .single()) and explicit terminals
      if (m === 'maybeSingle' || m === 'single' || m === 'insert') {
        return Promise.resolve(result);
      }
      return chain;
    });
  });
  return chain;
};

let errSpy:  jest.SpyInstance;
let warnSpy: jest.SpyInstance;

beforeEach(() => {
  jest.resetAllMocks();
  errSpy  = jest.spyOn(console, 'error').mockImplementation(() => {});
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  // Default: rpc succeeds (covers fire-and-forget logAuditAction calls inside confirmImageRights)
  rpc.mockResolvedValue({ data: null, error: null });
});

afterEach(() => {
  errSpy.mockRestore();
  warnSpy.mockRestore();
});

// ─── 1. confirmImageRights ────────────────────────────────────────────────────
//
// NOTE (20260406 — idempotency fix):
// confirmImageRights now performs a 60-min check BEFORE inserting.
// Mocking pattern: first from() call = check (maybeSingle), second = insert (direct await).
// Use mockReturnValueOnce to separate the two calls.

describe('confirmImageRights', () => {
  it('returns ok:true with a UUID confirmationId when insert succeeds', async () => {
    // First from() call: 60-min check finds nothing (no recent confirmation)
    from.mockReturnValueOnce(makeChain({ data: null, error: null }));
    // Second from() call: insert succeeds (no error)
    from.mockReturnValueOnce(makeChain({ data: null, error: null }));

    const result = await confirmImageRights({
      userId:  'user-1',
      modelId: 'model-1',
      orgId:   'org-1',
    });

    expect(result.ok).toBe(true);
    // confirmationId is now a client-generated UUID (no longer from DB row)
    if (result.ok) expect(typeof result.data.confirmationId).toBe('string');
    expect(from).toHaveBeenCalledWith('image_rights_confirmations');
  });

  it('returns reused confirmationId without inserting when recent confirmation exists', async () => {
    // 60-min check finds a recent confirmation → returns 'reused' immediately, no insert
    from.mockReturnValueOnce(makeChain({ data: { id: 'conf-existing' }, error: null }));

    const result = await confirmImageRights({ userId: 'user-1', modelId: 'model-1' });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.confirmationId).toBe('reused');
    // Only 1 call to from(): the check — no second call for insert
    expect(from).toHaveBeenCalledTimes(1);
  });

  it('returns ok:true and treats 23505 unique violation as idempotent success', async () => {
    // Check: no recent confirmation
    from.mockReturnValueOnce(makeChain({ data: null, error: null }));
    // Insert: unique constraint violation (race condition)
    from.mockReturnValueOnce(makeChain({ data: null, error: { message: 'duplicate key', code: '23505' } }));

    const result = await confirmImageRights({ userId: 'user-1', modelId: 'model-1' });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.confirmationId).toBe('reused');
  });

  it('returns ok:false when DB returns a non-duplicate error', async () => {
    // Check: no recent confirmation
    from.mockReturnValueOnce(makeChain({ data: null, error: null }));
    // Insert: generic error (not 23505)
    from.mockReturnValueOnce(makeChain({ data: null, error: { message: 'rls_violation', code: 'P0001' } }));

    const result = await confirmImageRights({ userId: 'user-1', modelId: 'model-1' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('rls_violation');
    expect(errSpy).toHaveBeenCalled();
  });

  it('returns ok:false with invalid_org_id on FK violation (23503)', async () => {
    from.mockReturnValueOnce(makeChain({ data: null, error: null }));
    from.mockReturnValueOnce(makeChain({
      data: null,
      error: {
        message: 'insert or update on table violates foreign key constraint',
        code: '23503',
        details: 'Key (org_id)=(...) is not present in table "organizations".',
      },
    }));

    const result = await confirmImageRights({
      userId: 'user-1',
      modelId: 'model-1',
      orgId: 'not-an-org-uuid',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invalid_org_id');
    expect(errSpy).toHaveBeenCalled();
  });

  it('returns ok:false on exception (fail-closed)', async () => {
    from.mockImplementation(() => { throw new Error('network'); });

    const result = await confirmImageRights({ userId: 'user-1', modelId: null });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('exception');
    expect(errSpy).toHaveBeenCalled();
  });

  it('stores null model_id and session_key when modelId is null (non-model-scoped upload)', async () => {
    // First call: check hasRecentImageRightsForSessionKey (no recent)
    from.mockReturnValueOnce(makeChain({ data: null, error: null }));
    // Second call: insert — use a tracked chain to verify payload
    const insertChain = makeChain({ data: null, error: null });
    from.mockReturnValueOnce(insertChain);

    const result = await confirmImageRights({ userId: 'u1', modelId: null, sessionKey: 'recruiting-chat:t1' });

    expect(result.ok).toBe(true);
    expect(insertChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ model_id: null, session_key: 'recruiting-chat:t1' }),
    );
  });
});

// ─── 2. hasRecentImageRightsConfirmation ─────────────────────────────────────

describe('hasRecentImageRightsConfirmation', () => {
  it('returns true when a recent confirmation exists within the time window', async () => {
    from.mockReturnValue(makeChain({ data: { id: 'conf-1' }, error: null }));

    const result = await hasRecentImageRightsConfirmation('user-1', 'model-1', 15);

    expect(result).toBe(true);
  });

  it('returns false when no recent confirmation exists (data is null)', async () => {
    from.mockReturnValue(makeChain({ data: null, error: null }));

    const result = await hasRecentImageRightsConfirmation('user-1', 'model-1', 15);

    expect(result).toBe(false);
  });

  it('returns false on exception (fail-closed)', async () => {
    from.mockImplementation(() => { throw new Error('network'); });

    const result = await hasRecentImageRightsConfirmation('user-1', 'model-1');

    expect(result).toBe(false);
    expect(errSpy).toHaveBeenCalled();
  });
});

// ─── 3. hasRecentImageRightsForSessionKey ────────────────────────────────────

describe('hasRecentImageRightsForSessionKey', () => {
  it('returns true when session-scoped confirmation found', async () => {
    from.mockReturnValue(makeChain({ data: { id: 'conf-1' }, error: null }));

    const result = await hasRecentImageRightsForSessionKey('user-1', 'recruiting-chat:t-1');

    expect(result).toBe(true);
    const chain = from.mock.results[0].value as Record<string, jest.Mock>;
    expect(chain.eq).toHaveBeenCalledWith('session_key', 'recruiting-chat:t-1');
  });

  it('returns false when no session-scoped confirmation exists', async () => {
    from.mockReturnValue(makeChain({ data: null, error: null }));

    expect(await hasRecentImageRightsForSessionKey('user-1', 'option-doc:req-1')).toBe(false);
  });

  it('returns false on exception (fail-closed)', async () => {
    from.mockImplementation(() => { throw new Error('db down'); });

    expect(await hasRecentImageRightsForSessionKey('u1', 'key-1')).toBe(false);
    expect(errSpy).toHaveBeenCalled();
  });
});

// ─── 4. guardUploadSession ───────────────────────────────────────────────────

describe('guardUploadSession', () => {
  it('returns ok:true when image rights were recently confirmed for the session', async () => {
    // hasRecentImageRightsForSessionKey → data found
    from.mockReturnValue(makeChain({ data: { id: 'conf-1' }, error: null }));

    const result = await guardUploadSession('user-1', 'recruiting-chat:t-1');

    expect(result.ok).toBe(true);
  });

  it('returns ok:false and logs security event when rights not confirmed', async () => {
    // First from() call (hasRecent) → null. Second from() call (security_events insert) → ok.
    from
      .mockReturnValueOnce(makeChain({ data: null, error: null }))  // hasRecent → not found
      .mockReturnValue({ insert: jest.fn().mockResolvedValue({ error: null }) }); // logSecurityEvent

    const result = await guardUploadSession('user-1', 'option-doc:req-1');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('image_rights_not_confirmed');
  });

  it('returns ok:false when hasRecentImageRightsForSessionKey throws', async () => {
    from.mockImplementation(() => { throw new Error('network'); });

    const result = await guardUploadSession('user-1', 'key-1');

    expect(result.ok).toBe(false);
  });
});

// ─── 5. logAuditAction ───────────────────────────────────────────────────────

describe('logAuditAction', () => {
  it('calls log_audit_action RPC with correct parameters', async () => {
    rpc.mockResolvedValue({ data: null, error: null });

    await logAuditAction({
      orgId:      'org-1',
      actionType: 'booking_created',
      entityType: 'booking',
      entityId:   'bk-1',
      oldData:    { status: 'draft' },
      newData:    { status: 'confirmed' },
    });

    expect(rpc).toHaveBeenCalledWith('log_audit_action', expect.objectContaining({
      p_org_id:      'org-1',
      p_action_type: 'booking_created',
      p_entity_type: 'booking',
      p_entity_id:   'bk-1',
    }));
  });

  it('does not throw when RPC returns an error (fire-and-forget safe)', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'rls' } });

    await expect(logAuditAction({
      orgId: 'org-1', actionType: 'model_created',
    })).resolves.toBeUndefined();

    expect(errSpy).toHaveBeenCalled();
  });

  it('does not throw on exception (fire-and-forget safe)', async () => {
    rpc.mockRejectedValue(new Error('connection reset'));

    await expect(logAuditAction({
      orgId: 'org-1', actionType: 'profile_updated',
    })).resolves.toBeUndefined();

    expect(errSpy).toHaveBeenCalled();
  });

  it('passes old_data and new_data as JSON strings', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    const old = { status: 'pending' };
    const nw  = { status: 'confirmed' };

    await logAuditAction({ orgId: 'org-1', actionType: 'booking_confirmed', oldData: old, newData: nw });

    const call = rpc.mock.calls[0][1];
    expect(JSON.parse(call.p_old_data)).toEqual(old);
    expect(JSON.parse(call.p_new_data)).toEqual(nw);
  });
});

// ─── 6. logBookingAction ─────────────────────────────────────────────────────

describe('logBookingAction', () => {
  it('calls log_audit_action with entityType=booking and correct action', async () => {
    rpc.mockResolvedValue({ data: null, error: null });

    await logBookingAction('org-1', 'booking_confirmed', 'bk-42', { model_id: 'm-1' });

    expect(rpc).toHaveBeenCalledWith('log_audit_action', expect.objectContaining({
      p_action_type: 'booking_confirmed',
      p_entity_type: 'booking',
      p_entity_id:   'bk-42',
    }));
  });

  it('passes oldState as p_old_data', async () => {
    rpc.mockResolvedValue({ data: null, error: null });

    await logBookingAction('org-1', 'booking_cancelled', 'bk-1', {}, { status: 'confirmed' });

    const call = rpc.mock.calls[0][1];
    expect(JSON.parse(call.p_old_data)).toEqual({ status: 'confirmed' });
  });

  it('fires without throwing even when RPC errors', async () => {
    rpc.mockRejectedValue(new Error('network'));

    await expect(logBookingAction('org-1', 'booking_created', 'bk-99')).resolves.toBeUndefined();
  });
});

// ─── 7. logOptionAction ──────────────────────────────────────────────────────

describe('logOptionAction', () => {
  it('calls log_audit_action with entityType=option_request and correct action', async () => {
    rpc.mockResolvedValue({ data: null, error: null });

    await logOptionAction('org-1', 'option_sent', 'req-7');

    expect(rpc).toHaveBeenCalledWith('log_audit_action', expect.objectContaining({
      p_action_type: 'option_sent',
      p_entity_type: 'option_request',
      p_entity_id:   'req-7',
    }));
  });

  it('supports price-negotiation action types', async () => {
    rpc.mockResolvedValue({ data: null, error: null });

    await logOptionAction('org-1', 'option_price_countered', 'req-8', { amount: 2500 });

    expect(rpc).toHaveBeenCalledWith('log_audit_action', expect.objectContaining({
      p_action_type: 'option_price_countered',
    }));
  });

  it('supports option_document_uploaded action type', async () => {
    rpc.mockResolvedValue({ data: null, error: null });

    await logOptionAction('org-1', 'option_document_uploaded', 'req-9', { file: 'brief.pdf' });

    expect(rpc).toHaveBeenCalledWith('log_audit_action', expect.objectContaining({
      p_action_type: 'option_document_uploaded',
    }));
  });
});

// ─── 8. deleteOrganizationData ───────────────────────────────────────────────

describe('deleteOrganizationData', () => {
  it('returns ok:true on successful deletion', async () => {
    rpc.mockResolvedValue({ data: null, error: null });

    const result = await deleteOrganizationData('org-1');

    expect(result.ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith('delete_organization_data', { p_org_id: 'org-1' });
  });

  it('returns ok:false with reason only_owner_can_delete_organization when non-owner calls', async () => {
    rpc.mockResolvedValue({
      data:  null,
      error: { message: 'only_owner_can_delete_organization' },
    });

    const result = await deleteOrganizationData('org-1');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('only_owner_can_delete_organization');
  });

  it('returns ok:false with error message on generic DB error', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'foreign_key_violation' } });

    const result = await deleteOrganizationData('org-1');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('foreign_key_violation');
    expect(errSpy).toHaveBeenCalled();
  });

  it('returns ok:false with reason=exception on throw (fail-closed)', async () => {
    rpc.mockRejectedValue(new Error('network timeout'));

    const result = await deleteOrganizationData('org-1');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('exception');
  });
});
