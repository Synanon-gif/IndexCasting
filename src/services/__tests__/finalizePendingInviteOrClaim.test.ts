const mockMaybeSingle = jest.fn().mockResolvedValue({ data: { role: 'model', is_admin: false }, error: null });
const mockEq = jest.fn().mockReturnValue({ maybeSingle: mockMaybeSingle });
const mockSelect = jest.fn().mockReturnValue({ eq: mockEq });

jest.mock('../../../lib/supabase', () => ({
  supabase: {
    rpc: jest.fn(),
    from: jest.fn().mockReturnValue({ select: mockSelect }),
    auth: {
      getUser: jest.fn(() => Promise.resolve({ data: { user: { id: 'user-1' } }, error: null })),
      getSession: jest.fn(() => Promise.resolve({ data: { session: { user: { id: 'user-1' } } }, error: null })),
    },
  },
}));

jest.mock('../organizationsInvitationsSupabase');
jest.mock('../modelsSupabase');
jest.mock('../../storage/inviteToken', () => ({
  readInviteToken: jest.fn(),
  persistInviteToken: jest.fn(),
  markInviteFlowFromUrl: jest.fn(),
  isInviteFlowActive: jest.fn(),
}));
jest.mock('../../storage/modelClaimToken', () => ({
  readModelClaimToken: jest.fn(),
  persistModelClaimToken: jest.fn(),
  markModelClaimFlowFromUrl: jest.fn(),
  isModelClaimFlowActive: jest.fn(),
}));

jest.mock('../../utils/inviteClaimSuccessBus', () => ({
  emitInviteClaimSuccess: jest.fn(),
}));

import { finalizePendingInviteOrClaim } from '../finalizePendingInviteOrClaim';
import { emitInviteClaimSuccess } from '../../utils/inviteClaimSuccessBus';
import * as orgInv from '../organizationsInvitationsSupabase';
import * as modelsSup from '../modelsSupabase';
import * as inviteStorage from '../../storage/inviteToken';
import * as claimStorage from '../../storage/modelClaimToken';

const readInviteToken = inviteStorage.readInviteToken as jest.MockedFunction<
  typeof inviteStorage.readInviteToken
>;
const persistInviteToken = inviteStorage.persistInviteToken as jest.MockedFunction<
  typeof inviteStorage.persistInviteToken
>;
const readModelClaimToken = claimStorage.readModelClaimToken as jest.MockedFunction<
  typeof claimStorage.readModelClaimToken
>;
const persistModelClaimToken = claimStorage.persistModelClaimToken as jest.MockedFunction<
  typeof claimStorage.persistModelClaimToken
>;
const acceptOrganizationInvitation = orgInv.acceptOrganizationInvitation as jest.MockedFunction<
  typeof orgInv.acceptOrganizationInvitation
>;
const claimModelByToken = modelsSup.claimModelByToken as jest.MockedFunction<
  typeof modelsSup.claimModelByToken
>;

const emitInviteClaimSuccessMock = emitInviteClaimSuccess as jest.MockedFunction<
  typeof emitInviteClaimSuccess
>;

describe('finalizePendingInviteOrClaim', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    emitInviteClaimSuccessMock.mockClear();
    readInviteToken.mockResolvedValue(null);
    readModelClaimToken.mockResolvedValue(null);
  });

  it('runs org invite only when no claim token (invite-first, claim skipped)', async () => {
    readInviteToken.mockResolvedValue('inv_tok');
    readModelClaimToken.mockResolvedValue(null);
    acceptOrganizationInvitation.mockResolvedValue({ ok: true, organization_id: 'org-1' });
    const onOk = jest.fn().mockResolvedValue(undefined);

    const r = await finalizePendingInviteOrClaim({ onSuccessReloadProfile: onOk });

    expect(acceptOrganizationInvitation).toHaveBeenCalledWith('inv_tok');
    expect(claimModelByToken).not.toHaveBeenCalled();
    expect(r.invite.ok).toBe(true);
    expect(r.invite.state).toBe('success');
    expect(r.invite.organizationId).toBe('org-1');
    expect(persistInviteToken).toHaveBeenCalledWith(null);
    expect(onOk).toHaveBeenCalledTimes(1);
    expect(emitInviteClaimSuccessMock).toHaveBeenCalledWith({
      kind: 'invite',
      organizationId: 'org-1',
    });
  });

  it('runs claim in same finalize run after successful invite when both tokens present', async () => {
    readInviteToken.mockResolvedValue('inv_tok');
    readModelClaimToken.mockResolvedValue('claim_tok');
    acceptOrganizationInvitation.mockResolvedValue({ ok: true, organization_id: 'org-1' });
    claimModelByToken.mockResolvedValue({ ok: true, data: { modelId: 'm1', agencyId: 'a1' } });
    const onOk = jest.fn().mockResolvedValue(undefined);

    const r = await finalizePendingInviteOrClaim({ onSuccessReloadProfile: onOk });

    expect(acceptOrganizationInvitation).toHaveBeenCalledWith('inv_tok');
    expect(claimModelByToken).toHaveBeenCalledWith('claim_tok');
    expect(r.invite.ok).toBe(true);
    expect(r.claim.ok).toBe(true);
    expect(r.invite.state).toBe('success');
    expect(r.claim.state).toBe('success');
    expect(r.claim.modelId).toBe('m1');
    expect(persistInviteToken).toHaveBeenCalledWith(null);
    expect(persistModelClaimToken).toHaveBeenCalledWith(null);
    expect(onOk).toHaveBeenCalledTimes(1);
    expect(emitInviteClaimSuccessMock).toHaveBeenNthCalledWith(1, {
      kind: 'invite',
      organizationId: 'org-1',
    });
    expect(emitInviteClaimSuccessMock).toHaveBeenNthCalledWith(2, {
      kind: 'claim',
      modelId: 'm1',
      agencyId: 'a1',
    });
  });

  it('still runs claim when invite fails fatally (independent flows)', async () => {
    readInviteToken.mockResolvedValue('inv_tok');
    readModelClaimToken.mockResolvedValue('claim_tok');
    acceptOrganizationInvitation.mockResolvedValue({ ok: false, error: 'email_mismatch' });
    claimModelByToken.mockResolvedValue({ ok: true, data: { modelId: 'm1', agencyId: 'a1' } });

    const r = await finalizePendingInviteOrClaim({});

    expect(claimModelByToken).toHaveBeenCalledWith('claim_tok');
    expect(r.invite.ok).toBe(false);
    expect(r.invite.state).toBe('fatal');
    expect(r.claim.attempted).toBe(true);
    expect(r.claim.ok).toBe(true);
  });

  it('keeps invite token for retryable invite errors but still runs claim', async () => {
    readInviteToken.mockResolvedValue('inv_tok');
    readModelClaimToken.mockResolvedValue('claim_tok');
    acceptOrganizationInvitation.mockResolvedValue({ ok: false, error: 'temporary_network_error' });
    claimModelByToken.mockResolvedValue({ ok: true, data: { modelId: 'm1', agencyId: 'a1' } });

    const r = await finalizePendingInviteOrClaim({});

    expect(r.invite.state).toBe('retryable');
    expect(persistInviteToken).not.toHaveBeenCalledWith(null);
    expect(claimModelByToken).toHaveBeenCalledWith('claim_tok');
    expect(r.claim.attempted).toBe(true);
    expect(r.claim.ok).toBe(true);
  });

  it('runs claim when no invite token', async () => {
    readModelClaimToken.mockResolvedValue('claim_tok');
    claimModelByToken.mockResolvedValue({ ok: true, data: { modelId: 'm1', agencyId: 'a1' } });

    const r = await finalizePendingInviteOrClaim({});

    expect(claimModelByToken).toHaveBeenCalledWith('claim_tok');
    expect(r.claim.ok).toBe(true);
    expect(r.claim.state).toBe('success');
    expect(r.claim.modelId).toBe('m1');
    expect(r.claim.agencyId).toBe('a1');
    expect(persistModelClaimToken).toHaveBeenCalledWith(null);
    expect(emitInviteClaimSuccessMock).toHaveBeenCalledWith({
      kind: 'claim',
      modelId: 'm1',
      agencyId: 'a1',
    });
  });

  it('keeps claim token when claim is retryable after successful invite', async () => {
    readInviteToken.mockResolvedValue('inv_tok');
    readModelClaimToken.mockResolvedValue('claim_tok');
    acceptOrganizationInvitation.mockResolvedValue({ ok: true, organization_id: 'org-1' });
    claimModelByToken.mockResolvedValue({ ok: false, error: 'temporary_claim_failure' });
    const onOk = jest.fn().mockResolvedValue(undefined);

    const r = await finalizePendingInviteOrClaim({ onSuccessReloadProfile: onOk });

    expect(r.invite.state).toBe('success');
    expect(r.claim.state).toBe('retryable');
    expect(persistInviteToken).toHaveBeenCalledWith(null);
    expect(persistModelClaimToken).not.toHaveBeenCalledWith(null);
    expect(onOk).toHaveBeenCalledTimes(1);
    expect(emitInviteClaimSuccessMock).toHaveBeenCalledTimes(1);
    expect(emitInviteClaimSuccessMock).toHaveBeenCalledWith({
      kind: 'invite',
      organizationId: 'org-1',
    });
  });

  it('clears invite token on fatal invite error', async () => {
    readInviteToken.mockResolvedValue('bad');
    acceptOrganizationInvitation.mockResolvedValue({ ok: false, error: 'email_mismatch' });

    await finalizePendingInviteOrClaim({});

    expect(persistInviteToken).toHaveBeenCalledWith(null);
  });

  it('no-op when no tokens', async () => {
    await finalizePendingInviteOrClaim({});
    await finalizePendingInviteOrClaim({});
    expect(acceptOrganizationInvitation).not.toHaveBeenCalled();
    expect(claimModelByToken).not.toHaveBeenCalled();
  });

  it('skips claim when current user is admin (token preserved)', async () => {
    readModelClaimToken.mockResolvedValue('claim_tok');
    mockMaybeSingle.mockResolvedValueOnce({ data: { role: 'admin', is_admin: true }, error: null });

    const r = await finalizePendingInviteOrClaim({});

    expect(claimModelByToken).not.toHaveBeenCalled();
    expect(r.claim.attempted).toBe(false);
    expect(persistModelClaimToken).not.toHaveBeenCalledWith(null);
  });

  it('skips claim when current user is agent (token preserved)', async () => {
    readModelClaimToken.mockResolvedValue('claim_tok');
    mockMaybeSingle.mockResolvedValueOnce({ data: { role: 'agent', is_admin: false }, error: null });

    const r = await finalizePendingInviteOrClaim({});

    expect(claimModelByToken).not.toHaveBeenCalled();
    expect(r.claim.attempted).toBe(false);
    expect(persistModelClaimToken).not.toHaveBeenCalledWith(null);
  });
});
