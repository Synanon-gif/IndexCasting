/**
 * Stale invite tokens in storage can make a fresh Agency/Client signup run
 * accept_organization_invitation first, which skips owner bootstrap (user ends up as booker).
 * Clear storage when the user is not in the invite URL flow.
 */
export async function clearInviteTokenIfPlainSignup(isInviteSignup: boolean): Promise<void> {
  if (isInviteSignup) return;
  try {
    const { persistInviteToken } = await import('../storage/inviteToken');
    await persistInviteToken(null);
  } catch (e) {
    console.error('clearInviteTokenIfPlainSignup:', e);
  }
}

export async function clearInviteTokenIfPlainSignIn(clearStale: boolean): Promise<void> {
  if (!clearStale) return;
  try {
    const { persistInviteToken } = await import('../storage/inviteToken');
    await persistInviteToken(null);
  } catch (e) {
    console.error('clearInviteTokenIfPlainSignIn:', e);
  }
}
