-- ============================================================================
-- Admin Security Hardening — 2026-04-08
--
-- Fixes from Security Audit (admin_security_audit plan):
--
-- HR-1 (VULN-09): admin_update_profile_full — p_role validation
--   The function accepted any role string including 'admin', which allowed the
--   platform admin to promote arbitrary users to role='admin' via the app RPC.
--   Fix: reject any p_role value not in the safe signup-role allowlist.
--
-- HR-2: admin_update_profile_full — weak admin guard
--   The function checked `SELECT is_admin FROM profiles WHERE id = auth.uid()`
--   instead of the UUID+email-pinned assert_is_admin(). Per admin-security.mdc
--   rule 6, every admin RPC must call assert_is_admin() as its first statement.
--
-- M-1: Trigger cleanup
--   Old triggers trg_prevent_admin_flag_escalation (uses current_setting('role')
--   — more permissive, allows service_role) and trg_prevent_is_admin_escalation
--   (M5 migration) may still exist alongside the current
--   trg_prevent_privilege_escalation. Drop them to eliminate ambiguity.
--
-- M-2: admin_update_model_all RLS policy is effectively dead
--   After REVOKE SELECT (is_admin) FROM authenticated, the policy condition
--   `is_admin = TRUE` always evaluates to false. Replace with is_current_user_admin().
--   Apply the same fix to admin_update_org_all if still using the old pattern.
--
-- M-3: admin_overrides policies — remove any residual admin_full_access_overrides
--   The original FOR ALL admin policy should already be gone, but drop it again
--   idempotently and ensure only the RPC-based SELECT policy exists for admins.
--
-- ADMIN_UUID:  fb0ab854-d0c3-4e09-a39c-269d60246927
-- ADMIN_EMAIL: rubenelge@t-online.de
-- ============================================================================

-- ── HR-1 + HR-2: Harden admin_update_profile_full ────────────────────────────
--
-- Changes vs. migration_admin_update_profile_no_admin_escalation.sql:
--   1. Guard replaced with PERFORM assert_is_admin() (UUID+email pin).
--   2. p_role validated against safe allowlist — 'admin' and unknown values
--      raise an exception before any UPDATE executes.
--   3. is_admin NOT written (unchanged from #78, kept explicit by omission).

CREATE OR REPLACE FUNCTION public.admin_update_profile_full(
  target_id     UUID,
  p_display_name TEXT    DEFAULT NULL,
  p_email        TEXT    DEFAULT NULL,
  p_company_name TEXT    DEFAULT NULL,
  p_phone        TEXT    DEFAULT NULL,
  p_website      TEXT    DEFAULT NULL,
  p_country      TEXT    DEFAULT NULL,
  p_role         TEXT    DEFAULT NULL,
  p_is_active    BOOLEAN DEFAULT NULL,
  p_is_admin     BOOLEAN DEFAULT NULL   -- accepted for API compat; intentionally IGNORED
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- HR-2: UUID+email-pinned guard — only the platform admin can proceed.
  -- Replaces the old `SELECT is_admin FROM profiles` check.
  PERFORM public.assert_is_admin();

  -- HR-1 (VULN-09): Reject any role value that is not a safe user-facing role.
  -- 'admin' must never be assignable via this RPC to prevent UI-level privilege
  -- escalation (the promoted user would reach AdminDashboard but all backend RPCs
  -- would still fail the UUID+email pin — however, the invariant "only one admin"
  -- must be preserved at every layer).
  IF p_role IS NOT NULL AND p_role NOT IN ('client', 'agent', 'model', 'guest') THEN
    RAISE EXCEPTION
      'admin_update_profile_full: invalid role %. Allowed: client, agent, model, guest.',
      p_role;
  END IF;

  UPDATE public.profiles
  SET
    display_name = COALESCE(p_display_name, display_name),
    email        = COALESCE(p_email,        email),
    company_name = COALESCE(p_company_name, company_name),
    phone        = COALESCE(p_phone,        phone),
    website      = COALESCE(p_website,      website),
    country      = COALESCE(p_country,      country),
    role         = COALESCE(p_role,         role),
    is_active    = COALESCE(p_is_active,    is_active),
    -- is_admin intentionally omitted: privilege changes must go through migrations only.
    updated_at   = now()
  WHERE id = target_id;

  INSERT INTO public.admin_logs (admin_id, action, target_user_id, details)
  VALUES (
    auth.uid(),
    'profile_edit',
    target_id,
    jsonb_build_object(
      'display_name', p_display_name,
      'email',        p_email,
      'company_name', p_company_name,
      'phone',        p_phone,
      'website',      p_website,
      'country',      p_country,
      'role',         p_role,
      'is_active',    p_is_active
      -- p_is_admin not logged: ignored by design
    )
  );

  RETURN true;
END;
$$;

REVOKE ALL    ON FUNCTION public.admin_update_profile_full(UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,BOOLEAN,BOOLEAN) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_profile_full(UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,BOOLEAN,BOOLEAN) TO authenticated;

COMMENT ON FUNCTION public.admin_update_profile_full IS
  'Admin only (UUID+email-pinned via assert_is_admin). '
  'Updates mutable profile fields. '
  'p_role must be one of: client, agent, model, guest — ''admin'' is rejected. '
  'p_is_admin is accepted for API compatibility but deliberately ignored; '
  'privilege changes require direct DB migrations.';


-- ── M-1: Drop stale escalation-prevention triggers ───────────────────────────
--
-- trg_prevent_admin_flag_escalation uses current_setting('role') != 'service_role'
-- which is more permissive than the current trigger (it allows service_role requests
-- to modify is_admin). The current trg_prevent_privilege_escalation uses
-- current_user IN ('postgres','supabase_admin','supabase_auth_admin') — stricter.
--
-- trg_prevent_is_admin_escalation was added in migration_m5_admin_rpc_hardening.sql
-- and was never explicitly dropped by later migrations.
--
-- Both are superseded by trg_prevent_privilege_escalation from 20260407_admin_final_fix.sql.

DROP TRIGGER IF EXISTS trg_prevent_admin_flag_escalation  ON public.profiles;
DROP TRIGGER IF EXISTS trg_prevent_is_admin_escalation    ON public.profiles;

-- Drop their backing functions if no other trigger references them.
-- Both functions are inlined in those migrations and not called elsewhere.
DROP FUNCTION IF EXISTS public.prevent_admin_flag_escalation()     CASCADE;
DROP FUNCTION IF EXISTS public.fn_prevent_is_admin_escalation()    CASCADE;


-- ── M-2: Fix RLS policies that use is_admin = TRUE directly ──────────────────
--
-- After REVOKE SELECT (is_admin, is_super_admin) FROM authenticated, any RLS
-- policy that reads profiles.is_admin in an authenticated context evaluates to
-- NULL (not TRUE), making the condition permanently false. Replace with the
-- SECURITY DEFINER function is_current_user_admin() which bypasses the REVOKE.

-- models — admin_update_model_all
DROP POLICY IF EXISTS "admin_update_model_all" ON public.models;
CREATE POLICY "admin_update_model_all"
  ON public.models
  FOR UPDATE
  TO authenticated
  USING     (public.is_current_user_admin())
  WITH CHECK(public.is_current_user_admin());

-- organizations — admin_update_org_all (may already use is_current_user_admin
-- from 20260405_admin_always_on.sql; DROP + re-create is idempotent)
DROP POLICY IF EXISTS "admin_update_org_all" ON public.organizations;
CREATE POLICY "admin_update_org_all"
  ON public.organizations
  FOR UPDATE
  TO authenticated
  USING     (public.is_current_user_admin())
  WITH CHECK(public.is_current_user_admin());

-- profiles — admin_select_all_profiles (if it exists using is_admin = TRUE)
-- The canonical admin select policy from 20260405_admin_always_on.sql already
-- uses is_current_user_admin(). Re-drop any residual old version:
DROP POLICY IF EXISTS "admin_select_all_profiles" ON public.profiles;
CREATE POLICY "admin_select_all_profiles"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (public.is_current_user_admin());


-- ── M-3: Ensure admin_overrides has no FOR ALL admin policy ──────────────────
--
-- migration_paywall_billing.sql created admin_full_access_overrides FOR ALL.
-- migration_security_admin_override_audit_2026_04.sql dropped it and added a
-- SELECT-only version. Verify idempotently: drop both old names, ensure only
-- the RPC-based SELECT policy exists for admins.
-- Writes go exclusively through admin_set_bypass_paywall() (SECURITY DEFINER).

DROP POLICY IF EXISTS "admin_full_access_overrides" ON public.admin_overrides;
DROP POLICY IF EXISTS "admin_select_overrides"      ON public.admin_overrides;

-- Re-create the canonical admin SELECT policy using is_current_user_admin().
CREATE POLICY "admin_select_overrides"
  ON public.admin_overrides
  FOR SELECT
  TO authenticated
  USING (public.is_current_user_admin());

-- Verification queries (run manually against the live DB to confirm):
--
-- 1. Triggers on profiles:
--    SELECT tgname, proname AS fn
--    FROM pg_trigger t JOIN pg_proc p ON t.tgfoid = p.oid
--    WHERE t.tgrelid = 'public.profiles'::regclass
--    ORDER BY tgname;
--    → only trg_prevent_privilege_escalation + profiles_updated_at should appear
--
-- 2. admin_update_profile_full guard:
--    As a non-admin user: SELECT admin_update_profile_full('any-uuid');
--    → ERROR: assert_is_admin: unauthorized
--
-- 3. p_role validation:
--    As admin: SELECT admin_update_profile_full('fb0ab854-...', p_role := 'admin');
--    → ERROR: admin_update_profile_full: invalid role admin.
--
-- 4. admin_overrides policies:
--    SELECT policyname, cmd FROM pg_policies WHERE tablename = 'admin_overrides';
--    → org_members_select_own_override (SELECT)
--    → admin_select_overrides (SELECT)   ← no FOR ALL / INSERT / UPDATE / DELETE
--
-- 5. models admin policy:
--    SELECT policyname, qual FROM pg_policies
--    WHERE tablename = 'models' AND policyname = 'admin_update_model_all';
--    → qual should contain 'is_current_user_admin()'
