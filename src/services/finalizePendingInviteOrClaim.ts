/**
 * Canonical session-driven finalization for org invites (?invite=) and model claim (?model_invite=).
 * Idempotent RPCs + mutex; tokens cleared only on success or fatal errors.
 */

import { Alert } from 'react-native';
import { acceptOrganizationInvitation } from './organizationsInvitationsSupabase';
import { claimModelByToken } from './modelsSupabase';
import { readInviteToken, persistInviteToken } from '../storage/inviteToken';
import { readModelClaimToken, persistModelClaimToken } from '../storage/modelClaimToken';
import { uiCopy } from '../constants/uiCopy';
import { emitInviteClaimSuccess } from '../utils/inviteClaimSuccessBus';

export type FinalizeInviteBranch = {
  attempted: boolean;
  ok: boolean;
  error?: string;
  /** Present when accept_organization_invitation succeeded. */
  organizationId?: string;
};

export type FinalizeClaimBranch = {
  attempted: boolean;
  ok: boolean;
  error?: string;
  modelId?: string;
  agencyId?: string;
};

export type FinalizeInviteClaimResult = {
  invite: FinalizeInviteBranch;
  claim: FinalizeClaimBranch;
};

const emptyResult = (): FinalizeInviteClaimResult => ({
  invite: { attempted: false, ok: false },
  claim: { attempted: false, ok: false },
});

let finalizeChain: Promise<FinalizeInviteClaimResult> = Promise.resolve(emptyResult());

function isFatalInviteError(err: string | undefined): boolean {
  return err === 'email_mismatch' || err === 'invalid_or_expired';
}

function isFatalClaimError(err: string | undefined): boolean {
  return (
    err === 'token_expired' ||
    err === 'token_already_used' ||
    err === 'token_not_found' ||
    err === 'no_result' ||
    (typeof err === 'string' && /token_not_found|token_expired|token_already_used/i.test(err))
  );
}

function showInviteAlerts(
  err: string | undefined,
  signOut?: () => void | Promise<void>,
): void {
  if (err === 'email_mismatch') {
    Alert.alert(
      uiCopy.inviteErrors.title,
      uiCopy.inviteErrors.emailMismatch,
      [
        ...(signOut
          ? [{ text: uiCopy.inviteErrors.signOutBtn, onPress: () => { void signOut(); }, style: 'destructive' as const }]
          : []),
        { text: uiCopy.inviteErrors.dismissBtn, style: 'cancel' },
      ],
    );
  } else if (err === 'invalid_or_expired') {
    Alert.alert(uiCopy.inviteErrors.title, uiCopy.inviteErrors.expiredOrUsed);
  } else if (err === 'already_member_of_another_org') {
    Alert.alert(uiCopy.inviteErrors.title, uiCopy.inviteErrors.alreadyMember);
  } else if (err) {
    Alert.alert(uiCopy.inviteErrors.title, uiCopy.inviteErrors.genericFail);
  }
}

function showClaimAlerts(err: string | undefined): void {
  if (isFatalClaimError(err)) {
    Alert.alert(uiCopy.modelClaimErrors.title, uiCopy.modelClaimErrors.expiredOrUsed);
  } else if (err) {
    Alert.alert(uiCopy.modelClaimErrors.title, uiCopy.modelClaimErrors.genericFail);
  }
}

export type FinalizePendingOptions = {
  /** Called after successful invite or claim so org/model context loads. */
  onSuccessReloadProfile?: () => void | Promise<void>;
  /** When true, show Alert on hard failures (App.tsx after URL persist). */
  showUiAlerts?: boolean;
  signOut?: () => void | Promise<void>;
};

/** RPC + token persistence only; no reload / success emit (caller decides). */
async function runClaimMutationOnly(
  claimTok: string,
  out: FinalizeInviteClaimResult,
  opts: FinalizePendingOptions,
): Promise<void> {
  out.claim.attempted = true;
  const claimRes = await claimModelByToken(claimTok);
  out.claim.ok = claimRes.ok;
  out.claim.error = claimRes.ok ? undefined : claimRes.error;

  if (claimRes.ok) {
    if (claimRes.data) {
      const { modelId, agencyId } = claimRes.data;
      out.claim.modelId = modelId;
      out.claim.agencyId = agencyId;
    }
    await persistModelClaimToken(null);
  } else if (isFatalClaimError(out.claim.error)) {
    await persistModelClaimToken(null);
    if (opts.showUiAlerts) showClaimAlerts(out.claim.error);
    console.warn('[finalizePendingInviteOrClaim] claim fatal', {
      flow: 'model_claim',
      error: out.claim.error,
    });
  } else {
    console.warn('[finalizePendingInviteOrClaim] claim non-fatal (token kept)', {
      flow: 'model_claim',
      error: out.claim.error,
    });
    if (opts.showUiAlerts && out.claim.error) showClaimAlerts(out.claim.error);
  }
}

/**
 * Runs org-invite acceptance first if a pending invite token exists; then model claim when invite
 * succeeded in the same run and a claim token was present (both tokens are read from storage).
 * Serialized globally so bootstrap + effects do not double-RPC.
 */
export function finalizePendingInviteOrClaim(
  opts: FinalizePendingOptions = {},
): Promise<FinalizeInviteClaimResult> {
  const run = async (): Promise<FinalizeInviteClaimResult> => {
    try {
      return await runInner();
    } catch (e) {
      console.error('[finalizePendingInviteOrClaim] unexpected error:', e);
      return emptyResult();
    }
  };

  const runInner = async (): Promise<FinalizeInviteClaimResult> => {
    const out = emptyResult();
    const inviteTok = await readInviteToken();
    const claimTok = await readModelClaimToken();

    if (inviteTok) {
      out.invite.attempted = true;
      const inv = await acceptOrganizationInvitation(inviteTok);
      out.invite.ok = !!inv.ok;
      out.invite.error = inv.ok ? undefined : (inv.error as string | undefined);

      if (!inv.ok) {
        if (isFatalInviteError(out.invite.error)) {
          await persistInviteToken(null);
          if (opts.showUiAlerts) showInviteAlerts(out.invite.error, opts.signOut);
          else
            console.error('[finalizePendingInviteOrClaim] invite fatal', {
              flow: 'agency_client_invite',
              error: out.invite.error,
            });
        } else {
          console.warn('[finalizePendingInviteOrClaim] invite non-fatal (token kept)', {
            flow: 'agency_client_invite',
            error: out.invite.error,
          });
          if (opts.showUiAlerts && out.invite.error) showInviteAlerts(out.invite.error, opts.signOut);
        }
        return out;
      }

      const orgId = inv.organization_id;
      if (orgId) out.invite.organizationId = orgId;
      await persistInviteToken(null);

      if (claimTok) {
        await runClaimMutationOnly(claimTok, out, opts);
      }

      try {
        await opts.onSuccessReloadProfile?.();
      } catch (e) {
        console.error('[finalizePendingInviteOrClaim] onSuccessReloadProfile after invite chain error:', e);
      }
      if (orgId) emitInviteClaimSuccess({ kind: 'invite', organizationId: orgId });
      if (out.claim.ok && out.claim.modelId && out.claim.agencyId) {
        emitInviteClaimSuccess({
          kind: 'claim',
          modelId: out.claim.modelId,
          agencyId: out.claim.agencyId,
        });
      }
      return out;
    }

    if (claimTok) {
      await runClaimMutationOnly(claimTok, out, opts);
      if (out.claim.ok) {
        try {
          await opts.onSuccessReloadProfile?.();
        } catch (e) {
          console.error('[finalizePendingInviteOrClaim] onSuccessReloadProfile after claim error:', e);
        }
        if (out.claim.modelId && out.claim.agencyId) {
          emitInviteClaimSuccess({
            kind: 'claim',
            modelId: out.claim.modelId,
            agencyId: out.claim.agencyId,
          });
        }
      }
    }

    return out;
  };

  finalizeChain = finalizeChain.then(run, run);
  return finalizeChain;
}
