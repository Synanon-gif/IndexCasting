import { clearInviteTokenIfPlainSignup, clearInviteTokenIfPlainSignIn } from '../authInviteTokenPolicy';

const persistInviteToken = jest.fn();

jest.mock('../../storage/inviteToken', () => ({
  persistInviteToken: (...args: unknown[]) => persistInviteToken(...args),
}));

describe('authInviteTokenPolicy', () => {
  beforeEach(() => {
    persistInviteToken.mockClear();
  });

  it('clears token when not an invite signup', async () => {
    await clearInviteTokenIfPlainSignup(false);
    expect(persistInviteToken).toHaveBeenCalledWith(null);
  });

  it('does not clear when invite signup', async () => {
    await clearInviteTokenIfPlainSignup(true);
    expect(persistInviteToken).not.toHaveBeenCalled();
  });

  it('clears token when plain sign-in requests it', async () => {
    await clearInviteTokenIfPlainSignIn(true);
    expect(persistInviteToken).toHaveBeenCalledWith(null);
  });

  it('does not clear when invite sign-in', async () => {
    await clearInviteTokenIfPlainSignIn(false);
    expect(persistInviteToken).not.toHaveBeenCalled();
  });
});
