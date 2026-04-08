# Invite / claim / membership finalization — report

## Scope

Unified **session + token** driven finalization for agency booker invites, client employee invites, and model claim tokens; removed fragile **FLOW_KEY gating** and **mount-time stray token deletion** on web; added **DB idempotency** for replay-safe RPCs.

## What changed

- **New** [`src/services/finalizePendingInviteOrClaim.ts`](src/services/finalizePendingInviteOrClaim.ts): single entry point, global promise-chain mutex, org invite before model claim, token clearing only on success or fatal errors, optional `showUiAlerts`.
- **Storage** ([`inviteToken.ts`](src/storage/inviteToken.ts), [`modelClaimToken.ts`](src/storage/modelClaimToken.ts)): web uses **localStorage** + migration from sessionStorage; FLOW keys remain for telemetry only.
- **Auth** ([`AuthContext.tsx`](src/context/AuthContext.tsx)): `finalizePendingInviteOrClaim` at end of `bootstrapThenLoadProfile` for non-admin, non-guest profiles; **early finalize** on `signUp` when `hasSession` (before owner org RPCs); **`isInviteSignup` error** only when `hasSession && invite attempted && !ok` (defers to first login when email confirm has no session); `useEffect` on `session` + `!loading` for late-persisted URL tokens; **removed** duplicate invite/claim from `signIn` Step 2 (kept `linkModelByEmail`).
- **App** ([`App.tsx`](App.tsx)): removed effects that cleared pending tokens on mount without URL; invite/model URL effects **await persist then preview then finalize** when session exists; alerts via finalize `showUiAlerts`.
- **Persistence** ([`persistence.ts`](src/storage/persistence.ts)): sign-out clears `ic_pending_*` / `ic_*_flow_active` localStorage keys.
- **DB** [`supabase/migrations/20260408_invite_claim_idempotent_finalization.sql`](supabase/migrations/20260408_invite_claim_idempotent_finalization.sql): `accept_organization_invitation` returns success if caller already member of target org; `claim_model_by_token` no-op success if model already linked to caller or repair path if token consumed but model unlinked.

## Deployed

- Migration pushed via Supabase Management API → **HTTP 201**.

## Explicitly not changed

- `get_my_org_context`, admin RPCs, paywall, RLS policies (except replaced function bodies above).
- **signIn Step 1** isolation: `bootstrapThenLoadProfile` still runs alone in its `try`; finalization remains **after** successful profile load inside `bootstrapThenLoadProfile`, not merged into Step 1 `try`.

## Risks / follow-up

- **Concurrent finalize + plain signup**: existing `clearInviteTokenIfPlainSignup` mitigates stray tokens for non-invite signup.
- **Live verify**: run `pg_get_functiondef` for both functions in production when convenient (API verify query may time out).

## Rules / docs

- [`.cursor/rules/invite-finalization.mdc`](.cursor/rules/invite-finalization.mdc)
- [`docs/INVITE_CLAIM_ASSIGNMENT_CONSISTENCY.md`](docs/INVITE_CLAIM_ASSIGNMENT_CONSISTENCY.md) updated.
