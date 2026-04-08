/**
 * Merge URL + storage invite/claim tokens for unauthenticated routing.
 * Matches finalizePendingInviteOrClaim: org invite wins; model claim only when no pending invite.
 */
export function resolveInviteAndClaimTokensForRouting(
  urlInvite: string | null,
  urlClaim: string | null,
  storageInvite: string | null,
  storageClaim: string | null,
): { invite: string | null; claim: string | null } {
  const norm = (s: string | null | undefined) => {
    const t = (s ?? '').trim();
    return t.length > 0 ? t : null;
  };
  const invite = norm(urlInvite) ?? norm(storageInvite);
  const claim = invite ? null : norm(urlClaim) ?? norm(storageClaim);
  return { invite, claim };
}
