-- ============================================================================
-- Admin Login Fix — 2026-04-05
--
-- Fixes two issues that caused admin users to loop back to AuthScreen after
-- login:
--
-- 1. `get_own_admin_flags` – made more robust with a COALESCE fallback so
--    it always returns exactly one row (never an empty result set, which
--    would leave `is_admin = false` in the frontend).
--
-- 2. `admin_get_profiles` – was missing entirely. AuthContext fallback was
--    calling `isCurrentUserAdmin()` which direct-queries `is_admin`, but
--    that column may be effectively protected. Now the RPC exists and is
--    used directly by the AdminDashboard.
-- ============================================================================

-- ── 1. Robust get_own_admin_flags — always returns exactly one row ────────────
-- Uses a subquery UNION ALL + LIMIT 1 pattern so the function never returns
-- an empty result set. If the profile row exists it wins (comes first);
-- otherwise the fallback false/false row is returned.
CREATE OR REPLACE FUNCTION public.get_own_admin_flags()
RETURNS TABLE(is_admin boolean, is_super_admin boolean)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT a.is_admin, a.is_super_admin
  FROM (
    SELECT
      COALESCE(p.is_admin,       false) AS is_admin,
      COALESCE(p.is_super_admin, false) AS is_super_admin,
      1 AS ord
    FROM public.profiles p
    WHERE p.id = auth.uid()

    UNION ALL

    SELECT false, false, 2
  ) a
  ORDER BY a.ord
  LIMIT 1;
$$;

REVOKE ALL    ON FUNCTION public.get_own_admin_flags() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_own_admin_flags() TO authenticated;

-- ── 2. Create admin_get_profiles — required by AdminDashboard ─────────────────
CREATE OR REPLACE FUNCTION public.admin_get_profiles(
  p_active_only   boolean DEFAULT NULL,
  p_inactive_only boolean DEFAULT NULL,
  p_role          text    DEFAULT NULL
)
RETURNS TABLE(
  id                          uuid,
  email                       text,
  display_name                text,
  role                        text,
  is_active                   boolean,
  is_admin                    boolean,
  tos_accepted                boolean,
  privacy_accepted            boolean,
  agency_model_rights_accepted boolean,
  activation_documents_sent   boolean,
  verification_email          text,
  company_name                text,
  phone                       text,
  country                     text,
  created_at                  timestamptz,
  deactivated_at              timestamptz,
  deactivated_reason          text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Guard: only callable by platform admins.
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.is_admin = TRUE
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN QUERY
  SELECT
    pr.id,
    pr.email,
    pr.display_name,
    pr.role::text,
    pr.is_active,
    pr.is_admin,
    pr.tos_accepted,
    pr.privacy_accepted,
    pr.agency_model_rights_accepted,
    pr.activation_documents_sent,
    pr.verification_email,
    pr.company_name,
    pr.phone,
    pr.country,
    pr.created_at,
    pr.deactivated_at,
    pr.deactivated_reason
  FROM public.profiles pr
  WHERE
    (p_active_only   IS NULL OR (p_active_only   = TRUE  AND pr.is_active = TRUE))
    AND (p_inactive_only IS NULL OR (p_inactive_only = TRUE  AND pr.is_active = FALSE))
    AND (p_role          IS NULL OR pr.role::text = p_role)
  ORDER BY pr.created_at DESC;
END;
$$;

REVOKE ALL    ON FUNCTION public.admin_get_profiles(boolean, boolean, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_profiles(boolean, boolean, text) TO authenticated;
