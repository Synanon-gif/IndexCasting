jest.mock('../../../lib/supabase', () => ({
  supabase: {
    rpc: jest.fn(),
    from: jest.fn(),
    auth: {
      getUser: jest.fn(() => Promise.resolve({ data: { user: { id: 'user-1' } }, error: null })),
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

import { finalizePendingInviteOrClaim } from '../finalizePendingInviteOrClaim';
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

describe('finalizePendingInviteOrClaim', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    readInviteToken.mockResolvedValue(null);
    readModelClaimToken.mockResolvedValue(null);
  });

  it('runs org invite first and skips claim when invite token present', async () => {
    readInviteToken.mockResolvedValue('inv_tok');
    acceptOrganizationInvitation.mockResolvedValue({ ok: true, organization_id: 'org-1' });
    const onOk = jest.fn().mockResolvedValue(undefined);

    const r = await finalizePendingInviteOrClaim({ onSuccessReloadProfile: onOk });

    expect(acceptOrganizationInvitation).toHaveBeenCalledWith('inv_tok');
    expect(claimModelByToken).not.toHaveBeenCalled();
    expect(r.invite.ok).toBe(true);
    expect(persistInviteToken).toHaveBeenCalledWith(null);
    expect(onOk).toHaveBeenCalled();
  });

  it('runs claim when no invite token', async () => {
    readModelClaimToken.mockResolvedValue('claim_tok');
    claimModelByToken.mockResolvedValue({ ok: true, data: { modelId: 'm1', agencyId: 'a1' } });

    const r = await finalizePendingInviteOrClaim({});

    expect(claimModelByToken).toHaveBeenCalledWith('claim_tok');
    expect(r.claim.ok).toBe(true);
    expect(persistModelClaimToken).toHaveBeenCalledWith(null);
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
});
