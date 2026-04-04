-- ============================================================================
-- Canonical profiles SELECT policy — 2026-04-05
--
-- Resolves conflict between:
--   • supabase/migration_security_audit_2026_04_fixes.sql (root)
--     → created "profiles_org_scoped_read" (org-scoped) but is MISSING the
--       cross-org conversation participant condition that was explicitly
--       documented in its own comment.
--   • supabase/migrations/20260404_security_audit_fixes.sql
--     → created "Profiles limited public read" (USING true + column REVOKE)
--       which contradicts the org-scoped policy above.
--   • supabase/migration_rls_fix_profiles_email.sql
--     → created "profiles_select_authenticated" (USING true, email/phone REVOKED)
--
-- All of these are dropped here; replaced by a single authoritative policy.
--
-- Final access model:
--   1. Own profile — always readable (needed for AuthContext, app routing).
--   2. Same-org members — booker↔booker, owner↔booker, client employees, etc.
--   3. Cross-org conversation participants — required for B2B messenger UI
--      (display_name resolution across agencies and client orgs). This is
--      the missing condition that broke cross-org chat display names.
--   4. Models in the caller's agency with linked user accounts — agency members
--      must be able to resolve profile info (display_name, avatar_url) for
--      their own models that have signed up.
--
-- Column-level protection (idempotent):
--   • is_admin, is_super_admin — read via get_own_admin_flags() RPC only
--   • email, phone — read via get_current_user_email() / get_org_member_emails() only
-- ============================================================================

-- ── 1. Drop all existing SELECT policies on profiles (idempotent) ─────────────
DROP POLICY IF EXISTS "Profiles are readable by authenticated"  ON public.profiles;
DROP POLICY IF EXISTS "profiles_select_authenticated"          ON public.profiles;
DROP POLICY IF EXISTS "Profiles limited public read"           ON public.profiles;
DROP POLICY IF EXISTS "profiles_org_scoped_read"               ON public.profiles;
-- "Users can read own profile" is folded into the new policy below:
DROP POLICY IF EXISTS "Users can read own profile"             ON public.profiles;

-- ── 2. Single canonical SELECT policy ────────────────────────────────────────
CREATE POLICY "profiles_org_scoped_read"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (
    -- Own profile is always accessible (AuthContext, profile setup flows)
    id = auth.uid()

    -- Same-org members: booker↔booker, owner↔booker, client employees, etc.
    OR id IN (
      SELECT om2.user_id
      FROM   public.organization_members om2
      WHERE  om2.organization_id IN (
        SELECT om1.organization_id
        FROM   public.organization_members om1
        WHERE  om1.user_id = auth.uid()
      )
    )

    -- Cross-org conversation participants (B2B messenger)
    -- Allows agency booker to resolve a client user's display_name and vice versa.
    -- Uses GIN index on conversations.participant_ids for performance.
    OR EXISTS (
      SELECT 1
      FROM   public.conversations c
      WHERE  auth.uid() = ANY(c.participant_ids)
        AND  profiles.id = ANY(c.participant_ids)
    )

    -- Models in the caller's agency that have a linked user account
    -- Needed for agency roster views where model profile data is displayed
    OR id IN (
      SELECT m.user_id
      FROM   public.models m
      WHERE  m.user_id IS NOT NULL
        AND  EXISTS (
          SELECT 1
          FROM   public.organizations       o
          JOIN   public.organization_members om ON om.organization_id = o.id
          WHERE  o.agency_id  = m.agency_id
            AND  om.user_id   = auth.uid()
        )
    )
  );

-- ── 3. Column-level protection (idempotent REVOKEs) ──────────────────────────
-- SECURITY DEFINER functions bypass these and expose only what is needed:
--   get_own_admin_flags()      → own is_admin / is_super_admin
--   get_current_user_email()   → own email
--   get_org_member_emails()    → emails of own-org members (owner-gated)
--   admin_get_profiles()       → full profile rows for admins only
REVOKE SELECT (is_admin, is_super_admin) ON public.profiles FROM authenticated;
REVOKE SELECT (email, phone)             ON public.profiles FROM authenticated;

-- ── 4. Ensure get_own_admin_flags() RPC exists (idempotent) ──────────────────
-- AuthContext calls this instead of reading is_admin directly.
CREATE OR REPLACE FUNCTION public.get_own_admin_flags()
RETURNS TABLE(is_admin boolean, is_super_admin boolean)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT p.is_admin, p.is_super_admin
  FROM public.profiles p
  WHERE p.id = auth.uid();
$$;

REVOKE ALL    ON FUNCTION public.get_own_admin_flags() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_own_admin_flags() TO authenticated;
