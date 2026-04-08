# Invite finalization — diff summary

| Area | Files |
|------|--------|
| Finalize service | `src/services/finalizePendingInviteOrClaim.ts` (new) |
| Tests | `src/services/__tests__/finalizePendingInviteOrClaim.test.ts` (new) |
| Storage | `src/storage/inviteToken.ts`, `src/storage/modelClaimToken.ts`, `src/storage/persistence.ts` |
| Auth | `src/context/AuthContext.tsx` |
| Shell | `App.tsx` |
| DB | `supabase/migrations/20260408_invite_claim_idempotent_finalization.sql` |
| Rules / docs | `.cursor/rules/invite-finalization.mdc`, `docs/INVITE_CLAIM_ASSIGNMENT_CONSISTENCY.md` |

**Behavior:** Finalize runs from bootstrap (logged-in load), from `signUp` when session exists, from Auth `useEffect` when session+profile ready, and from `App` after URL token write. Tokens survive email-confirm tabs (localStorage). RPC replay is idempotent server-side.
