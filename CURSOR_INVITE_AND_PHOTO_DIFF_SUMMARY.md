# CURSOR_INVITE_AND_PHOTO_DIFF_SUMMARY

| File | Purpose | Risk | Tests |
|------|---------|------|--------|
| [`src/context/AuthContext.tsx`](src/context/AuthContext.tsx) | `signIn`: claim token via `readModelClaimToken()` only (removed `isModelClaimFlowActive()` gate) — parity with `signUp`. | Low: only runs when token present; same RPC as before. | `npm test`; manual model-claim sign-in after confirm. |
| [`supabase/migrations/20260501_can_view_model_photo_storage_client_row_alignment.sql`](supabase/migrations/20260501_can_view_model_photo_storage_client_row_alignment.sql) | Redefine `can_view_model_photo_storage`; storage SELECT policy passes full `name`. | Medium: storage access rules; mitigated by row-bound client check. | Live migration applied; client photo smoke test. |
| [`supabase/functions/send-invite/index.ts`](supabase/functions/send-invite/index.ts) | Extra paragraph in model claim HTML (confirm email + invite link). | Low (copy only). | Deployed `send-invite`. |
| [`docs/INVITE_CLAIM_ASSIGNMENT_CONSISTENCY.md`](docs/INVITE_CLAIM_ASSIGNMENT_CONSISTENCY.md) | Source of truth for invite/claim flows. | None | N/A |
| [`docs/CLIENT_MODEL_PHOTO_VISIBILITY.md`](docs/CLIENT_MODEL_PHOTO_VISIBILITY.md) | RLS vs storage alignment. | None | N/A |
| [`.cursorrules`](.cursorrules), [`.cursor/rules/auto-review.mdc`](.cursor/rules/auto-review.mdc), [`.cursor/rules/system-invariants.mdc`](.cursor/rules/system-invariants.mdc) | Guardrails | None | N/A |
