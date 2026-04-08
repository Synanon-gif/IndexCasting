# Invite finalize edge case (M1) — verify

Run after merge:

- [x] **invite-only unchanged** — only invite RPC, one reload, invite emit (`finalizePendingInviteOrClaim.test.ts`)
- [x] **claim-only unchanged** — no invite token, claim RPC, persist clear, emit on ok
- [x] **invite + claim together** — both RPCs same call, `onSuccessReloadProfile` once, both tokens cleared on double success, emits invite then claim
- [x] **no duplicate membership / model link** — behavior from idempotent RPCs; client does not double-call accept/claim in one branch
- [x] **no false success** — emits only after RPC ok + reload; claim emit requires `modelId`/`agencyId`
- [x] **invite fatal + claim token** — claim RPC not run; invite token cleared on fatal
- [x] **Token clears** — unchanged rules (success or fatal only)
- [x] **Auth/admin/paywall** — no edits to those layers
- [x] `npm run typecheck` — green
- [x] `npm run lint` — green
- [x] `npm test -- --passWithNoTests --ci` — green

**M2:** This change does not assert field-level RLS on `booking_brief` / `booking_details`.
