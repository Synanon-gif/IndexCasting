/**
 * Merge URL + storage invite/claim tokens for unauthenticated routing.
 * Org invite wins for **gate UI** (claim omitted from returned routing state when an invite exists).
 * Finalize (`finalizePendingInviteOrClaim`) still reads both tokens from storage and may claim after a successful invite in the same run.
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
