# CURSOR — GDPR Mini Hardening Report

## Goal

Minor data hygiene and lifecycle consistency **without** RLS changes, breaking schema changes, or business-logic changes.

## Implemented

### P1 — `conversations.participant_ids` cleanup

- New RPC [`cleanup_conversation_participants()`](supabase/migrations/20260512_gdpr_mini_hardening_cleanup_export_retention.sql): `SECURITY DEFINER`, `SET row_security TO off`, callable by **`service_role`** or **`is_current_user_admin()`** only. Rewrites `participant_ids` to only UUIDs that still exist in `auth.users`.
- [`delete-user` Edge Function](supabase/functions/delete-user/index.ts): **non-blocking** `rpc('cleanup_conversation_participants')` after successful `auth.admin.deleteUser` (best-effort; errors logged only).
- `COMMENT ON TABLE public.conversations` updated to document stale UUIDs and cleanup.

### P2 — Export guardrail

- `COMMENT ON FUNCTION public.export_user_data` extended with **GDPR EXPORT GUARDRail** text + pointer to checklist and `get_user_related_tables()`.
- New [`docs/GDPR_EXPORT_CHECKLIST.md`](docs/GDPR_EXPORT_CHECKLIST.md) for PR/developer review.
- New RPC **`get_user_related_tables()`** — returns static JSON list of tables covered by export (informational; `SECURITY DEFINER` + `auth.uid()` guard).

### P3 — Retention visibility

- [`docs/DATA_RETENTION_POLICY.md`](docs/DATA_RETENTION_POLICY.md): explicit labels (legal / business / no automatic deletion) and table of categories.
- `COMMENT ON TABLE` for `messages` and `calendar_entries` (retention hints only; **no** deletion jobs).

## Regression

- No changes to RLS policies, paywall, or core product flows beyond optional post-delete cleanup RPC.

## Verify

See [`CURSOR_GDPR_MINI_HARDENING_VERIFY.md`](CURSOR_GDPR_MINI_HARDENING_VERIFY.md).
