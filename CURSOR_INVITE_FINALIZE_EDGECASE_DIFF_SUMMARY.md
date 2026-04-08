# Invite finalize edge case (M1) — diff summary

| Area | Summary |
|------|---------|
| `finalizePendingInviteOrClaim.ts` | Always `readModelClaimToken()`; after invite success optionally `runClaimMutationOnly`; single reload + ordered emits for invite-success path; claim-only path unchanged |
| Tests | Invite-only explicit `null` claim token; new test both tokens → both RPCs, `onSuccessReloadProfile` ×1, emits nth 1–2; new test invite fatal → no claim RPC |
| Rules/docs | `invite-finalization.mdc` §2a; routing comment + consistency doc |
| Supabase | None |
