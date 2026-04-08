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

## Sign-in vs sign-up (claim token)

- Persisted token lives in `sessionStorage` (web) / AsyncStorage (native), key `ic_pending_model_claim_token`.
- **`signIn` and `signUp` must both read the token whenever it is present** (parity). Gating sign-in on `isModelClaimFlowActive()` alone caused post–email-confirm logins to skip `claimModelByToken` while the token was still stored.

## Email sources

- **Resend / `send-invite`**: agency-authored copy for org invites and model claim (`buildModelClaimEmail`). CTA uses the claim URL with `?model_invite=`.
- **Supabase Auth**: “Confirm your signup” (or similar) is **not** edited in this repo; it is configured in the Supabase dashboard. Users should complete confirm, then sign in; if linking does not complete, reopen the agency invitation link.

## Related code

- [`src/context/AuthContext.tsx`](../src/context/AuthContext.tsx) — claim after Step 1 bootstrap (isolated try blocks).
- [`App.tsx`](../App.tsx) — `tryClaimModelAfterSession`, stray-token cleanup vs `?model_invite=`.
- [`src/storage/modelClaimToken.ts`](../src/storage/modelClaimToken.ts)
- [`supabase/functions/send-invite`](../supabase/functions/send-invite/index.ts)
