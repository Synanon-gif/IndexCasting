# CURSOR_INVITE_CONTEXT_RESTORE_REPORT

## Problem

Persisted org-invite and model-claim tokens drove `finalizePendingInviteOrClaim` but **not** unauthenticated UI: `App.tsx` kept invite/claim routing state only from the URL on first paint, with no setters, so reload/tab without query string showed generic auth and could treat the user as “plain” sign-in (`clearStaleInviteOnSignIn` clearing the invite token on login).

## Solution

1. **Merge** URL and storage with the same precedence as finalize: invite first, then claim (`resolveInviteAndClaimTokensForRouting`).
2. **Web**: synchronous `localStorage` peek after existing session→local migration (`peekPendingInviteTokenSync`, `peekPendingModelClaimTokenSync`) so the gate/auth context appears without a flash.
3. **Native**: async `readInviteToken` / `readModelClaimToken` once on mount; short **loading** gate so `AuthScreen` does not run before tokens are known.
4. **Telemetry**: `markInviteFlowFromUrl` / `markModelClaimFlowFromUrl` only when the effective token came from the URL.

## Files touched

- `src/storage/inviteToken.ts`, `src/storage/modelClaimToken.ts`
- `src/utils/inviteClaimRouting.ts`, `src/utils/__tests__/inviteClaimRouting.test.ts`
- `App.tsx`
- `.cursor/rules/invite-finalization.mdc`

## Explicitly not changed

- `bootstrapThenLoadProfile`, `get_my_org_context`, admin RPCs, paywall core, `finalizePendingInviteOrClaim` semantics.

## Follow-up

UI Audit B remains useful for copy and transitions; functionally the documented persisted-token UI gap is closed.
