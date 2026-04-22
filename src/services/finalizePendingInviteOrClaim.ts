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
import { supabase } from '../../lib/supabase';
import { captureMessage as sentryCaptureMessage } from '../observability/sentry';

export type FinalizeInviteBranch = {
  attempted: boolean;
  ok: boolean;
  state: 'idle' | 'success' | 'retryable' | 'fatal' | 'already_done';
  error?: string;
  /** Present when accept_organization_invitation succeeded. */
  organizationId?: string;
};

export type FinalizeClaimBranch = {
  attempted: boolean;
  ok: boolean;
  state: 'idle' | 'success' | 'retryable' | 'fatal' | 'already_done';
  error?: string;
  modelId?: string;
  agencyId?: string;
};

export type FinalizeInviteClaimResult = {
  invite: FinalizeInviteBranch;
  claim: FinalizeClaimBranch;
};

const emptyResult = (): FinalizeInviteClaimResult => ({
  invite: { attempted: false, ok: false, state: 'idle' },
  claim: { attempted: false, ok: false, state: 'idle' },
});

let finalizeChain: Promise<FinalizeInviteClaimResult> = Promise.resolve(emptyResult());

function isFatalInviteError(err: string | undefined): boolean {
  return (
    err === 'email_mismatch' ||
    err === 'invalid_or_expired' ||
    err === 'already_member_of_another_org' ||
    err === 'wrong_profile_role'
  );
}

function isAlreadyDoneInviteError(err: string | undefined): boolean {
  if (!err) return false;
  return err === 'already_accepted' || /already_accepted|already_member/i.test(err);
}

function isFatalClaimError(err: string | undefined): boolean {
  return (
    err === 'token_expired' ||
    err === 'token_already_used' ||
    err === 'token_not_found' ||
    err === 'model_already_claimed_by_other_user' ||
    err === 'no_result' ||
    (typeof err === 'string' &&
      /token_not_found|token_expired|token_already_used|model_already_claimed_by_other_user/i.test(
        err,
      ))
  );
}

function isAlreadyDoneClaimError(err: string | undefined): boolean {
  if (!err) return false;
  // `model_already_claimed_by_other_user` (20261205 hardening) is a FATAL,
  // not "already done" — the current user is signing in with the wrong
  // account. Make sure the broader /already_claimed/ regex never swallows it.
  if (/model_already_claimed_by_other_user/i.test(err)) return false;
  return /already_linked|already_claimed/i.test(err);
}

function showInviteAlerts(err: string | undefined, signOut?: () => void | Promise<void>): void {
  if (err === 'email_mismatch') {
    Alert.alert(uiCopy.inviteErrors.title, uiCopy.inviteErrors.emailMismatch, [
      ...(signOut
        ? [
            {
              text: uiCopy.inviteErrors.signOutBtn,
              onPress: () => {
                void signOut();
              },
              style: 'destructive' as const,
            },
          ]
        : []),
      { text: uiCopy.inviteErrors.dismissBtn, style: 'cancel' },
    ]);
  } else if (err === 'invalid_or_expired') {
    Alert.alert(uiCopy.inviteErrors.title, uiCopy.inviteErrors.expiredOrUsed);
  } else if (err === 'already_member_of_another_org') {
    Alert.alert(uiCopy.inviteErrors.title, uiCopy.inviteErrors.alreadyMember);
  } else if (err === 'wrong_profile_role') {
    Alert.alert(uiCopy.inviteErrors.title, uiCopy.inviteErrors.wrongRole);
  } else if (err) {
    Alert.alert(uiCopy.inviteErrors.title, uiCopy.inviteErrors.genericFail);
  }
}

function showClaimAlerts(err: string | undefined): void {
  if (
    err === 'model_already_claimed_by_other_user' ||
    (typeof err === 'string' && /model_already_claimed_by_other_user/i.test(err))
  ) {
    Alert.alert(uiCopy.modelClaimErrors.title, uiCopy.modelClaimErrors.alreadyClaimedByOther);
  } else if (isFatalClaimError(err)) {
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

/**
 * Returns true if the current session user should NOT claim a model account.
 * Admins, agents, and clients must not have their profile role overwritten to 'model'.
 * The claim token is kept in storage for the correct user to consume later.
 */
async function shouldSkipClaimForCurrentUser(): Promise<boolean> {
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.user) return false;
    const { data } = await supabase
      .from('profiles')
      .select('role, is_admin')
      .eq('id', session.user.id)
      .maybeSingle();
    if (!data) return false;
    if (data.is_admin) {
      console.warn(
        '[finalizePendingInviteOrClaim] skipping claim — current user is admin; token preserved',
      );
      return true;
    }
    if (data.role === 'agent' || data.role === 'client') {
      console.warn(
        '[finalizePendingInviteOrClaim] skipping claim — current user role is',
        data.role,
        '; token preserved',
      );
      return true;
    }
    return false;
  } catch (e) {
    console.error('[finalizePendingInviteOrClaim] shouldSkipClaimForCurrentUser error:', e);
    return false;
  }
}

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
    out.claim.state = 'success';
    if (claimRes.data) {
      const { modelId, agencyId } = claimRes.data;
      out.claim.modelId = modelId;
      out.claim.agencyId = agencyId;
    }
    await persistModelClaimToken(null);
  } else if (isAlreadyDoneClaimError(out.claim.error)) {
    out.claim.state = 'already_done';
    await persistModelClaimToken(null);
    if (opts.showUiAlerts && out.claim.error) showClaimAlerts(out.claim.error);
  } else if (isFatalClaimError(out.claim.error)) {
    out.claim.state = 'fatal';
    await persistModelClaimToken(null);
    if (opts.showUiAlerts) showClaimAlerts(out.claim.error);
    console.warn('[finalizePendingInviteOrClaim] claim fatal', {
      flow: 'model_claim',
      error: out.claim.error,
    });
    // Sentry: nur Fehlercode, KEIN Token. Hilft, "already_claimed_by_other_user"
    // und Token-Lifecycle-Issues sofort sichtbar zu machen.
    sentryCaptureMessage(`model_claim_fatal:${out.claim.error ?? 'unknown'}`, 'error', {
      flow: 'model_claim',
      error_code: out.claim.error ?? null,
    });
  } else {
    out.claim.state = 'retryable';
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
        if (isAlreadyDoneInviteError(out.invite.error)) {
          out.invite.state = 'already_done';
          await persistInviteToken(null);
          if (opts.showUiAlerts && out.invite.error)
            showInviteAlerts(out.invite.error, opts.signOut);
        } else if (isFatalInviteError(out.invite.error)) {
          out.invite.state = 'fatal';
          await persistInviteToken(null);
          if (opts.showUiAlerts) showInviteAlerts(out.invite.error, opts.signOut);
          else
            console.error('[finalizePendingInviteOrClaim] invite fatal', {
              flow: 'agency_client_invite',
              error: out.invite.error,
            });
          // Sentry: Fehlercode (kein Token, keine PII).
          sentryCaptureMessage(`invite_accept_fatal:${out.invite.error ?? 'unknown'}`, 'error', {
            flow: 'agency_client_invite',
            error_code: out.invite.error ?? null,
          });
        } else {
          out.invite.state = 'retryable';
          console.warn('[finalizePendingInviteOrClaim] invite non-fatal (token kept)', {
            flow: 'agency_client_invite',
            error: out.invite.error,
          });
          if (opts.showUiAlerts && out.invite.error)
            showInviteAlerts(out.invite.error, opts.signOut);
        }
        // Do NOT return here — a pending model claim must still be attempted
        // even when the invite fails (they are independent flows).
      } else {
        const orgId = inv.organization_id;
        out.invite.state = 'success';
        if (orgId) out.invite.organizationId = orgId;
        await persistInviteToken(null);
        if (orgId) emitInviteClaimSuccess({ kind: 'invite', organizationId: orgId });
      }

      if (claimTok && !(await shouldSkipClaimForCurrentUser())) {
        await runClaimMutationOnly(claimTok, out, opts);
      }

      const anyOk = out.invite.ok || out.claim.ok;
      if (anyOk) {
        try {
          await opts.onSuccessReloadProfile?.();
        } catch (e) {
          console.error(
            '[finalizePendingInviteOrClaim] onSuccessReloadProfile after invite chain error:',
            e,
          );
        }
      }
      if (out.claim.ok && out.claim.modelId && out.claim.agencyId) {
        emitInviteClaimSuccess({
          kind: 'claim',
          modelId: out.claim.modelId,
          agencyId: out.claim.agencyId,
        });
      }
      return out;
    }

    if (claimTok && !(await shouldSkipClaimForCurrentUser())) {
      await runClaimMutationOnly(claimTok, out, opts);
      if (out.claim.ok) {
        try {
          await opts.onSuccessReloadProfile?.();
        } catch (e) {
          console.error(
            '[finalizePendingInviteOrClaim] onSuccessReloadProfile after claim error:',
            e,
          );
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
