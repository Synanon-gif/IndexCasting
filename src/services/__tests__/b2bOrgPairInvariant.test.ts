/**
 * B2B org-pair invariant tests.
 *
 * Canonical rule: for any two organizations there must be exactly ONE B2B
 * conversation. Thread identity is based on org pair only — never on the
 * specific user who starts the chat.
 */
import { b2bOrgPairContextId } from '../../utils/b2bOrgPairContextId';

describe('B2B org-pair invariant', () => {
  const CLIENT_ORG = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const AGENCY_ORG = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

  describe('context_id is deterministic and org-pair based', () => {
    it('produces the same context_id regardless of argument order', () => {
      expect(b2bOrgPairContextId(CLIENT_ORG, AGENCY_ORG)).toBe(
        b2bOrgPairContextId(AGENCY_ORG, CLIENT_ORG),
      );
    });

    it('includes both org IDs in the context_id', () => {
      const ctx = b2bOrgPairContextId(CLIENT_ORG, AGENCY_ORG);
      expect(ctx).toContain(CLIENT_ORG);
      expect(ctx).toContain(AGENCY_ORG);
      expect(ctx).toMatch(/^b2b:/);
    });

    it('different org pairs produce different context_ids', () => {
      const OTHER_ORG = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
      expect(b2bOrgPairContextId(CLIENT_ORG, AGENCY_ORG)).not.toBe(
        b2bOrgPairContextId(CLIENT_ORG, OTHER_ORG),
      );
    });

    it('same org pair always produces the same context_id (stable key)', () => {
      const calls = Array.from({ length: 10 }, () => b2bOrgPairContextId(CLIENT_ORG, AGENCY_ORG));
      expect(new Set(calls).size).toBe(1);
    });
  });

  describe('org-pair conversation identity (invariant assertions)', () => {
    it('owner and employee of the same org resolve to the same context_id', () => {
      const ownerCtx = b2bOrgPairContextId(CLIENT_ORG, AGENCY_ORG);
      const employeeCtx = b2bOrgPairContextId(CLIENT_ORG, AGENCY_ORG);
      expect(ownerCtx).toBe(employeeCtx);
    });

    it('context_id does not depend on user identity — only org identity', () => {
      const ctx1 = b2bOrgPairContextId(CLIENT_ORG, AGENCY_ORG);
      const ctx2 = b2bOrgPairContextId(CLIENT_ORG, AGENCY_ORG);
      expect(ctx1).toBe(ctx2);
      expect(ctx1).not.toContain('user');
    });

    it('two orgs in different orders still produce the same key', () => {
      const forward = b2bOrgPairContextId(CLIENT_ORG, AGENCY_ORG);
      const reverse = b2bOrgPairContextId(AGENCY_ORG, CLIENT_ORG);
      expect(forward).toBe(reverse);
    });
  });
});

describe('B2B service contracts (mocked)', () => {
  const CLIENT_ORG = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const AGENCY_ORG = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  const AGENCY_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
  const OWNER_USER = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
  const EMPLOYEE_USER = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
  const CONV_ID = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

  const rpc = jest.fn();
  const fromFn = jest.fn();
  const getUser = jest.fn();

  jest.mock('../../../lib/supabase', () => ({
    supabase: {
      rpc: (...args: unknown[]) => rpc(...args),
      from: (...args: unknown[]) => fromFn(...args),
      auth: { getUser: () => getUser() },
    },
  }));

  jest.mock('../organizationsInvitationsSupabase', () => ({
    listOrganizationMembers: jest.fn().mockResolvedValue([]),
  }));

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('resolveB2bChatOrganizationIds calls RPC with client user id', async () => {
    rpc.mockResolvedValue({
      data: { ok: true, client_org_id: CLIENT_ORG, agency_org_id: AGENCY_ORG },
      error: null,
    });

    const { resolveB2bChatOrganizationIds } = require('../b2bOrgChatSupabase');

    const r1 = await resolveB2bChatOrganizationIds(OWNER_USER, AGENCY_ID);
    const r2 = await resolveB2bChatOrganizationIds(EMPLOYEE_USER, AGENCY_ID);

    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    if (r1.ok && r2.ok) {
      expect(r1.client_org_id).toBe(r2.client_org_id);
      expect(r1.agency_org_id).toBe(r2.agency_org_id);
    }
  });

  it('findB2BConversationByOrgPair queries by context_id not user', async () => {
    const maybeSingle = jest.fn().mockResolvedValue({
      data: { id: CONV_ID },
      error: null,
    });
    const eqFn = jest.fn().mockReturnValue({ maybeSingle });
    const eqFn2 = jest.fn().mockReturnValue({ eq: eqFn });
    const selectFn = jest.fn().mockReturnValue({ eq: eqFn2 });
    fromFn.mockReturnValue({ select: selectFn });

    const { findB2BConversationByOrgPair } = require('../b2bOrgChatSupabase');

    const result = await findB2BConversationByOrgPair(CLIENT_ORG, AGENCY_ORG);
    expect(result?.id).toBe(CONV_ID);

    const expectedCtx = b2bOrgPairContextId(CLIENT_ORG, AGENCY_ORG);
    expect(eqFn).toHaveBeenCalledWith('context_id', expectedCtx);
  });
});
