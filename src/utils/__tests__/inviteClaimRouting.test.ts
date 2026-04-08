import { resolveInviteAndClaimTokensForRouting } from '../inviteClaimRouting';

describe('resolveInviteAndClaimTokensForRouting', () => {
  it('prefers URL invite over storage and drops claim', () => {
    expect(
      resolveInviteAndClaimTokensForRouting('u1', 'c1', 's1', 's2'),
    ).toEqual({ invite: 'u1', claim: null });
  });

  it('uses storage invite when URL empty', () => {
    expect(resolveInviteAndClaimTokensForRouting(null, 'c1', 's1', 's2')).toEqual({
      invite: 's1',
      claim: null,
    });
  });

  it('uses claim from URL when no invite', () => {
    expect(resolveInviteAndClaimTokensForRouting(null, 'c1', null, 's2')).toEqual({
      invite: null,
      claim: 'c1',
    });
  });

  it('uses storage claim when no invite and no URL claim', () => {
    expect(resolveInviteAndClaimTokensForRouting(null, null, null, 's2')).toEqual({
      invite: null,
      claim: 's2',
    });
  });

  it('trims whitespace and treats empty as absent', () => {
    expect(resolveInviteAndClaimTokensForRouting('  ', null, '  ok  ', null)).toEqual({
      invite: 'ok',
      claim: null,
    });
  });
});
