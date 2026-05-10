-- ────────────────────────────────────────────────────────────────────────────
-- Phase D-4: Revoke authenticated EXECUTE on get_accounts_to_purge()
-- ────────────────────────────────────────────────────────────────────────────
--
-- Discovered during the deep-audit pass after Phase D-3 (live-DB ACL inspection
-- on 2026-05-10 with Supabase Management API).
--
-- Background:
--   `public.get_accounts_to_purge()` returns the list of `auth.users.id`
--   UUIDs whose corresponding `public.profiles.deletion_requested_at` is
--   older than 30 days. It is a SECURITY DEFINER `STABLE` SQL function that
--   was added in `supabase/migration_account_self_deletion.sql` (Account Self
--   Deletion feature) and is intended to be called from a service-role cron
--   job / scheduled Edge Function:
--
--   > "Hinweis: Die endgültige Löschung von auth.users erfordert die Supabase
--   > Admin API (z.B. scheduled Edge Function: get_accounts_to_purge()
--   > aufrufen, dann für jede user_id supabase.auth.admin.deleteUser(user_id)
--   > ausführen)."
--
-- Issue:
--   Live-DB ACL on 2026-05-10 (after Phase D-3):
--     postgres=X/postgres, authenticated=X/postgres, service_role=X/postgres
--
--   This means ANY authenticated user could call the RPC and obtain the list
--   of UUIDs of accounts that requested deletion. That is a PII leak: the
--   set of "users in 30-day deletion grace period" should not be visible to
--   any product user.
--
-- Verification: NOT called from frontend or Edge Function code.
--   - `grep -r get_accounts_to_purge src/`              → 0 hits
--   - `grep -r get_accounts_to_purge supabase/functions/` → 0 hits
--   - Documented in `supabase/README.md` as service-role-only / cron path.
--
-- Fix:
--   Revoke EXECUTE from `authenticated`, `anon`, and `PUBLIC`. Keep the
--   default `postgres=X` and the implicit `service_role=X` so the cron /
--   scheduled Edge Function with service-role JWT continues to work.
--
-- Rollback:
--   GRANT EXECUTE ON FUNCTION public.get_accounts_to_purge() TO authenticated;
--
-- Risk:
--   None for product flows (no FE/EF callers).
--   Cron / service_role: still works via service_role implicit grant.
--
-- ────────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  -- Defense-in-depth: revoke from anon, authenticated, and PUBLIC.
  REVOKE EXECUTE ON FUNCTION public.get_accounts_to_purge() FROM PUBLIC;
  REVOKE EXECUTE ON FUNCTION public.get_accounts_to_purge() FROM anon;
  REVOKE EXECUTE ON FUNCTION public.get_accounts_to_purge() FROM authenticated;
EXCEPTION
  WHEN undefined_function THEN
    -- Function does not exist on this DB — this migration is a no-op.
    RAISE NOTICE 'public.get_accounts_to_purge() does not exist; skipping.';
END $$;

-- Verification: after this migration runs, the live ACL should be:
--   postgres=X/postgres, service_role=X/postgres
-- (no anon, no authenticated, no PUBLIC implicit).
