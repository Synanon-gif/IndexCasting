# Invite context restore — diff summary

## Storage

- **`src/storage/inviteToken.ts`**: `peekPendingInviteTokenSync()` — web-only, runs migration then reads `localStorage`.
- **`src/storage/modelClaimToken.ts`**: `peekPendingModelClaimTokenSync()` — same pattern for model claim.

## Routing helper

- **`src/utils/inviteClaimRouting.ts`**: `resolveInviteAndClaimTokensForRouting(urlInvite, urlClaim, storageInvite, storageClaim)` — invite wins; claim only if no invite.

## App shell

- **`App.tsx`**: Initial invite/claim tokens from URL + web peek (or null on native); native `useEffect` loads `readInviteToken` / `readModelClaimToken` and applies same merge; `nativeInviteClaimHydrated` spinner until native read completes; `markInviteFlowFromUrl` / `markModelClaimFlowFromUrl` only when token originated from URL; `AuthScreen` for `!effectiveRole` uses `clearStaleInviteOnSignIn={!(inviteTokenState || modelInviteTokenState)}`.

## Tests

- **`src/utils/__tests__/inviteClaimRouting.test.ts`**: merge/precedence and trim behavior.

## Rules

- **`.cursor/rules/invite-finalization.mdc`**: new §6 (routing + telemetry).

## Artefacts

- `CURSOR_INVITE_CONTEXT_RESTORE_*` (this file, REPORT, VERIFY, PLAN.json).
