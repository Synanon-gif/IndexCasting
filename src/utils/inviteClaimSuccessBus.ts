/**
 * Lightweight pub/sub so invite/claim finalization (finalizePendingInviteOrClaim) can
 * notify App UI for a one-time success banner without coupling to AuthContext internals.
 */

export type InviteClaimSuccessPayload =
  | { kind: 'invite'; organizationId: string }
  | { kind: 'claim'; modelId: string; agencyId: string };

type Listener = (payload: InviteClaimSuccessPayload) => void;

const listeners = new Set<Listener>();

export function subscribeInviteClaimSuccess(cb: Listener): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function emitInviteClaimSuccess(payload: InviteClaimSuccessPayload): void {
  for (const cb of listeners) {
    try {
      cb(payload);
    } catch (e) {
      console.error('[emitInviteClaimSuccess] listener error:', e);
    }
  }
}

/** @internal Tests only */
export function __resetInviteClaimSuccessListenersForTests(): void {
  listeners.clear();
}
