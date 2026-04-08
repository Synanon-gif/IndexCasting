# Invite, claim, and assignment consistency

## Flows

| Flow | Entry | Finalization |
|------|--------|----------------|
| Agency → Booker | `invitations` row + `?invite=` + `acceptOrganizationInvitation` | `organization_members` |
| Client → Employee | Same as Booker | `organization_members` |
| Agency → Model | `model_claim_tokens` + `?model_invite=` + `claim_model_by_token` | `models.user_id` (agency already on model row / territories) |

## Token security

- Model linking must **not** rely on email as the primary identity binding (see Risiko 9). The canonical path is **claim token**.
- Deprecated fallback: `link_model_by_email()` after sign-in/sign-up (still isolated in Step 2).

## Sign-in vs sign-up (claim + org invite)

- Persisted tokens (web): **`localStorage`** keys `ic_pending_invite_token`, `ic_pending_model_claim_token` (with one-time migration from legacy `sessionStorage`). Native: AsyncStorage.
- **Canonical finalization:** `finalizePendingInviteOrClaim()` — runs after `bootstrapThenLoadProfile` (non-admin, non-guest), on **session + !loading** in `AuthProvider`, and from **`App.tsx` after URL token is persisted** (with `showUiAlerts` for hard failures). **Org invite RPC runs before model claim** when both persisted tokens exist; after a **successful** invite, **model claim runs in the same finalize invocation** (one profile reload, then ordered success emits). **Routing** (`resolveInviteAndClaimTokensForRouting`) still prefers org-invite for unauthenticated gate UI only — finalize reads both tokens from storage regardless.
- **`isInviteFlowActive` / `isModelClaimFlowActive`** are **telemetry only**; they MUST NOT gate whether a stored token is read for finalization.

## Email sources

- **Resend / `send-invite`**: agency-authored copy for org invites and model claim (`buildModelClaimEmail`). CTA uses the claim URL with `?model_invite=`.
- **Org invitation payload:** Callers should send `invite_role`: `booker` (agency team tab) or `employee` (client team). The Edge Function uses this for the correct role label in the HTML email (Employee vs Booker). If omitted, the template defaults to Booker for backward compatibility.
- **Org invitation email copy** states that email confirmation (when enabled) must be completed before sign-in, that membership finalizes on first successful sign-in, and that the same invitation link may be reopened before expiry if needed — aligned with `finalizePendingInviteOrClaim` + stored tokens.
- **Supabase Auth**: “Confirm your signup” (or similar) is **not** edited in this repo; it is configured in the Supabase dashboard. Users should complete confirm, then sign in; if linking does not complete, reopen the agency invitation link.

## In-app UX (invite / signup / claim)

- **After sign-up with no session** (email confirmation enabled): [`AuthScreen`](../src/screens/AuthScreen.tsx) shows `uiCopy.auth.signUpEmailConfirmation*` so users know to verify email and sign in; invite/model-claim variants add org- or model-specific notes.
- **Invite and model-claim gates:** [`InviteAcceptanceScreen`](../src/screens/InviteAcceptanceScreen.tsx) and [`ModelClaimScreen`](../src/screens/ModelClaimScreen.tsx) use `uiCopy` to state the **fixed** role (Booker / Employee) or **model profile claim**, and to distinguish these flows from normal self-service organization creation (Owner path).
- **Auth during invite/claim:** [`AuthScreen`](../src/screens/AuthScreen.tsx) hides free role pills when `inviteAuth` / `modelClaimAuth` is set; subtitle and locked-role copy reinforce invitation context.
- **Success banner (post-finalization only):** After `finalizePendingInviteOrClaim` succeeds, `emitInviteClaimSuccess` + [`App.tsx`](../App.tsx) show a dismissible banner with copy from `uiCopy.inviteClaimSuccess` (resolved via [`inviteClaimSuccessUi.ts`](../src/services/inviteClaimSuccessUi.ts)). This MUST NOT replace or mimic “signup complete” before RPC finalization. If **both** invite and claim succeed in one finalize run, two emits fire in order (invite then claim); the banner resolver is async and the **last** resolved message may win visually — rare combined case.

## Related code

- [`src/services/finalizePendingInviteOrClaim.ts`](../src/services/finalizePendingInviteOrClaim.ts) — mutex + org-then-claim RPC order + same-run claim after successful invite + token clear rules.
- [`src/context/AuthContext.tsx`](../src/context/AuthContext.tsx) — `bootstrapThenLoadProfile` tail; early finalize on `signUp` when `hasSession`; session `useEffect` for late URL tokens.
- [`App.tsx`](../App.tsx) — persist `?invite=` / `?model_invite=` then finalize when session exists (no mount-time stray-token wipe).
- [`src/storage/inviteToken.ts`](../src/storage/inviteToken.ts), [`src/storage/modelClaimToken.ts`](../src/storage/modelClaimToken.ts)
- [`supabase/migrations/20260408_invite_claim_idempotent_finalization.sql`](../supabase/migrations/20260408_invite_claim_idempotent_finalization.sql) — idempotent RPCs.
- [`supabase/functions/send-invite`](../supabase/functions/send-invite/index.ts)
