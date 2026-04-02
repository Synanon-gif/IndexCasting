-- =============================================================================
-- Security Advisor Fixes – 2026-04
--
-- Addresses all Security Advisor findings:
--   ERROR: security_definer_view (3x) → recreate with security_invoker = true
--   WARN:  function_search_path_mutable (14x) → ALTER FUNCTION SET search_path
--   WARN:  extension_in_public (pg_trgm) → move to extensions schema
--   WARN:  rls_policy_always_true (badges, boosts) → tighten WITH CHECK
--   INFO:  auth_leaked_password_protection → manual Dashboard action (not SQL)
-- =============================================================================


-- ─── FIX 1: Security Definer Views ───────────────────────────────────────────
--
-- Recreate with security_invoker = true so that RLS policies of the querying
-- user are enforced instead of the view creator's permissions.


-- 1a) model_traction
--     Counts stippen (likes) per model. Respects models + stippen RLS of caller.
DROP VIEW IF EXISTS public.model_traction;
CREATE VIEW public.model_traction
WITH (security_invoker = true) AS
SELECT
  m.id    AS model_id,
  m.name,
  m.agency_id,
  COUNT(s.id)::INTEGER AS stippen_count
FROM public.models m
LEFT JOIN public.stippen s ON s.to_model_id = m.id
GROUP BY m.id, m.name, m.agency_id;


-- 1b) replication_slot_health
--     Internal monitoring view – readable only by roles that have direct
--     pg_replication_slots access (i.e. postgres / service_role).
--     SELECT on authenticated was already revoked in
--     migration_security_hardening_audit_fixes.sql; kept that way.
DROP VIEW IF EXISTS public.replication_slot_health;
CREATE VIEW public.replication_slot_health
WITH (security_invoker = true) AS
SELECT
  slot_name,
  plugin,
  slot_type,
  active,
  active_pid,
  pg_size_pretty(
    pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)
  )                                            AS retained_wal,
  pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn) AS retained_bytes
FROM pg_replication_slots;

-- Ensure authenticated users cannot read replication internals.
REVOKE SELECT ON public.replication_slot_health FROM authenticated;
REVOKE SELECT ON public.replication_slot_health FROM anon;


-- 1c) models_with_territories
--     Latest body from migration_hybrid_location_discovery_models_country_code_and_rls.sql.
--     With security_invoker the caller's RLS on models / agencies is respected.
--     DROP + CREATE required: CREATE OR REPLACE fails when m.* column order diverges
--     from the stored view definition after table alterations (PG error 42P16).
DROP VIEW IF EXISTS public.models_with_territories;

CREATE VIEW public.models_with_territories
WITH (security_invoker = true) AS
SELECT
  m.*,
  mat.country_code AS territory_country_code,
  mat.agency_id    AS territory_agency_id,
  a.name           AS agency_name
FROM public.model_agency_territories mat
JOIN public.models   m ON m.id  = mat.model_id
JOIN public.agencies a ON a.id  = mat.agency_id;


-- ─── FIX 2: Function Search Path Mutable ─────────────────────────────────────
--
-- Pins each function's search_path to public so that an attacker cannot
-- shadow objects by manipulating the session-level search_path.
-- ALTER FUNCTION … SET search_path is idempotent and non-breaking.


-- Trigger functions (no arguments)
ALTER FUNCTION public.set_updated_at()                    SET search_path = public;
ALTER FUNCTION public.set_push_tokens_updated_at()        SET search_path = public;
ALTER FUNCTION public.set_model_locations_updated_at()    SET search_path = public;
ALTER FUNCTION public.fn_validate_option_status_transition() SET search_path = public;

-- Auth hook (no arguments)
ALTER FUNCTION public.handle_new_user()                   SET search_path = public;

-- Account management
ALTER FUNCTION public.cancel_account_deletion()           SET search_path = public;
ALTER FUNCTION public.get_accounts_to_purge()             SET search_path = public;

ALTER FUNCTION public.admin_set_account_active(
  uuid, boolean, text
) SET search_path = public;

ALTER FUNCTION public.admin_update_profile(
  uuid, text, text
) SET search_path = public;

-- Location RPCs
ALTER FUNCTION public.upsert_model_location(
  uuid, text, text, float, float, boolean, text
) SET search_path = public;

-- Paywall helpers (IMMUTABLE, LANGUAGE plpgsql – search_path fix still valid)
ALTER FUNCTION public.get_plan_swipe_limit(text)          SET search_path = public;
ALTER FUNCTION public.get_plan_storage_limit(text)        SET search_path = public;

-- Discovery RPCs
--   get_models_by_location already has SET search_path = public in its body
--   (migration_access_gate_enforcement.sql) but ALTER FUNCTION makes it
--   explicit at the catalog level and silences the advisor.
ALTER FUNCTION public.get_models_by_location(
  text, text, integer, integer, text, text, boolean, boolean,
  integer, integer, text, integer, integer, integer, integer,
  integer, integer, integer, integer, text, text[]
) SET search_path = public;

-- AI matching (pgvector <=> operator lives in public schema; no change needed
-- for the operator itself, but search_path must be pinned for safety).
ALTER FUNCTION public.match_models(
  vector(384), float, integer
) SET search_path = public;


-- ─── FIX 3: Extension in Public Schema (pg_trgm) ─────────────────────────────
--
-- Move pg_trgm from public to the dedicated extensions schema.
-- None of the flagged functions call pg_trgm operators directly (they use
-- built-in ILIKE / array operators), so no function body changes are required.
-- GIN indexes created with pg_trgm operator classes continue to work because
-- Postgres stores operator class OIDs, not schema-qualified names.

CREATE SCHEMA IF NOT EXISTS extensions;

GRANT USAGE ON SCHEMA extensions TO public;
GRANT USAGE ON SCHEMA extensions TO authenticated;
GRANT USAGE ON SCHEMA extensions TO anon;

-- Only move if it exists and is currently in public.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_extension e
    JOIN pg_namespace n ON n.oid = e.extnamespace
    WHERE e.extname = 'pg_trgm'
      AND n.nspname  = 'public'
  ) THEN
    ALTER EXTENSION pg_trgm SET SCHEMA extensions;
  END IF;
END $$;


-- ─── FIX 4: RLS Policies – Always True WITH CHECK ────────────────────────────


-- 4a) badges – INSERT
--     "System manages badges" used WITH CHECK (true), meaning any authenticated
--     user could insert arbitrary badges for any user_id.
--     Restriction: only admins may award badges (matches the "System" intent,
--     since admins act on behalf of the system via the Dashboard).

DROP POLICY IF EXISTS "System manages badges" ON public.badges;

CREATE POLICY "Admins manage badges"
  ON public.badges
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND is_admin = true
    )
  );


-- 4b) boosts – INSERT
--     "Model owner can boost" used WITH CHECK (true), meaning any authenticated
--     user could boost any model.
--     The boosts table has no boosted_by column; ownership is established by
--     checking that the caller's profile belongs to the same agency as the model.
--     Restriction: caller must be a profile whose agency_id matches the model's
--     agency_id (direct agency member check via profiles.agency_id).

DROP POLICY IF EXISTS "Model owner can boost" ON public.boosts;

CREATE POLICY "Model owner can boost"
  ON public.boosts
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.models m
      JOIN public.bookers b ON b.agency_id = m.agency_id
      WHERE m.id       = boosts.model_id
        AND b.user_id  = auth.uid()
    )
  );


-- ─── FIX 5: RLS Enabled No Policy (INFO) ────────────────────────────────────
--
-- Both tables are intentionally backend-only (no direct user access).
-- Explicit RESTRICTIVE deny policies make the intent clear and silence the
-- Security Advisor. service_role (Edge Functions) bypasses RLS entirely and
-- is unaffected by these policies.


-- 5a) guest_link_rate_limit
--     Written only by enforce_guest_link_rate_limit() (SECURITY DEFINER).
--     No authenticated or anon user should ever read or write it directly.
CREATE POLICY "No direct access – rate limit table"
  ON public.guest_link_rate_limit
  AS RESTRICTIVE FOR ALL
  TO authenticated, anon
  USING (false)
  WITH CHECK (false);


-- 5b) stripe_processed_events
--     Written only by the stripe-webhook Edge Function via service_role.
--     No authenticated or anon user should ever access it directly.
CREATE POLICY "No direct access – stripe idempotency table"
  ON public.stripe_processed_events
  AS RESTRICTIVE FOR ALL
  TO authenticated, anon
  USING (false)
  WITH CHECK (false);


-- ─── FIX 6: Leaked Password Protection ───────────────────────────────────────
--
-- This setting cannot be applied via SQL. Enable it manually:
--   Supabase Dashboard → Authentication → Security
--   → "Enable Leaked Password Protection" (HaveIBeenPwned check) → Save
--
-- No SQL changes required.
