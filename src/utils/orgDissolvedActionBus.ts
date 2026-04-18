/**
 * Lightweight pub/sub for OrgDissolvedBanner action buttons.
 *
 * The banner lives in App.tsx (rendered globally above every workspace), but
 * the Settings-Panel that exposes "Download my data" and "Delete my account"
 * lives inside the workspace views (ClientWebApp / AgencyControllerView).
 *
 * Instead of hoisting Settings state into App.tsx (which would couple the
 * banner to two unrelated workspace shells), we emit a simple action event
 * here. Each workspace view subscribes and opens its own Settings panel when
 * the event fires. Mirrors the inviteClaimSuccessBus pattern.
 */

export type OrgDissolvedAction = 'download_data' | 'delete_account';

type Listener = (action: OrgDissolvedAction) => void;

const listeners = new Set<Listener>();

export function subscribeOrgDissolvedAction(cb: Listener): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function emitOrgDissolvedAction(action: OrgDissolvedAction): void {
  for (const cb of listeners) {
    try {
      cb(action);
    } catch (e) {
      console.error('[emitOrgDissolvedAction] listener error:', e);
    }
  }
}

/** @internal Tests only */
export function __resetOrgDissolvedActionListenersForTests(): void {
  listeners.clear();
}
