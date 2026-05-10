-- ============================================================================
-- Shared selection — defense-in-depth: anon must not call HMAC oracle
--
-- Product split (canonical migration 20260810_security_shared_selection_hmac_token):
--   • `get_shared_selection_models(uuid[], text)` — GRANT anon + authenticated
--     → no-login viewers load the grid with URL token; internal body calls HMAC.
--   • `shared_selection_compute_hmac(uuid[])` — intended GRANT authenticated only;
--     used for logged-in share-link generation + Edge (`service_role`) token check.
--
-- Live / lint drift: CSV shows `anon` can EXECUTE `shared_selection_compute_hmac`
-- via PostgREST. That exposes a blind HMAC oracle (forge tokens for chosen ID lists)
-- unrelated to normal anon flow → REVOKE from `anon` only.
--
-- Unchanged by this migration: authenticated, service_role, postgres, PUBLIC (no-op
-- if anon lacked grant — REVOKE is idempotent-safe), `get_shared_selection_models`,
-- Storage, RLS, Auth.
--
-- Rollback (only if product explicitly needs anon HMAC RPC again — not recommended):
--   GRANT EXECUTE ON FUNCTION public.shared_selection_compute_hmac(uuid[]) TO anon;
--
-- Smoke (after deploy, staging first):
--   1. Authenticated user generates Shared Selection share link (HMAC RPC OK).
--   2. Anon/incognito opens valid shared link (get_shared_selection_models OK).
--   3. Images via sign-guest-storage-asset (shared_selection context) OK.
--   4. Wrong token still blocked.
--   5. Edge logs — no spike in 500 on token_validation_shared_selection path.
--   6. get_shared_selection_models remains callable anon with valid token.
--   7. PostgREST anon POST /rpc/shared_selection_compute_hmac — expect permission denied / 404 per API.
-- ============================================================================

DO $$
BEGIN
  -- Guard: Postgres returns **parameter names** in pg_get_function_identity_arguments()
  -- (see 20261322_security_lint_phase_d_hardening.sql — mismatch was `target_id uuid`,
  -- not plain `uuid`). A bare `uuid[]` comparison can false-negative → REVOKE never runs.
  -- Also accept regprocedure-normalized oid text (drops optional `public.` prefix).
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'shared_selection_compute_hmac'
      AND (
        pg_catalog.pg_get_function_identity_arguments(p.oid) IN ('p_model_ids uuid[]', 'uuid[]')
        OR regexp_replace((p.oid::regprocedure)::text, '^public\.', '')
          = 'shared_selection_compute_hmac(uuid[])'
      )
  ) THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.shared_selection_compute_hmac(uuid[]) FROM anon';
  END IF;
END;
$$;
