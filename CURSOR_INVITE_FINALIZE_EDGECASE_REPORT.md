# Invite finalize edge case (M1) — report

## Problem

`finalizePendingInviteOrClaim` read `readModelClaimToken()` only when no invite token was present (`claimTok = inviteTok ? null : await readModelClaimToken()`). After a successful org invite it returned immediately, so a persisted model-claim token stayed until a **later** finalize invocation.

## Fix

- Always read both tokens from storage at the start of a finalize run.
- On **successful** invite: clear invite token, then if a claim token was read, run `claim_model_by_token` in the **same** `runInner` (via `runClaimMutationOnly`).
- **One** `onSuccessReloadProfile` after the invite+claim chain when invite succeeded (covers invite-only, invite+claim success, invite+claim failure paths where org join still happened).
- Success emits after reload: invite first (if `organization_id` present), then claim (if claim RPC ok and `modelId`/`agencyId` present).
- Invite **fatal** / **non-fatal**: unchanged — claim is **not** run (invite-first product rule).

## Files touched

| File | Change |
|------|--------|
| `src/services/finalizePendingInviteOrClaim.ts` | Same-run claim after successful invite; extracted `runClaimMutationOnly`; reload/emit sequencing |
| `src/services/__tests__/finalizePendingInviteOrClaim.test.ts` | Combined-flow test; fatal invite + claim token test; invite-only rename |
| `.cursor/rules/invite-finalization.mdc` | §2a + §6 routing vs finalize clarification |
| `docs/INVITE_CLAIM_ASSIGNMENT_CONSISTENCY.md` | Canonical finalization + banner note |
| `src/utils/inviteClaimRouting.ts` | Comment: routing vs finalize |

## Out of scope (unchanged)

- `AuthContext`, `bootstrapThenLoadProfile`, `get_my_org_context`, admin RPCs, paywall core, Supabase/Edge.
- `booking_brief` / field-level RLS (M2).

## UX note

Rare **invite + claim** same-run success: two `emitInviteClaimSuccess` calls; `App.tsx` resolves banner text asynchronously — last resolved string may dominate (documented in `INVITE_CLAIM_ASSIGNMENT_CONSISTENCY.md`).

## Status

**INVITE FINALIZE EDGECASE FIXED**
