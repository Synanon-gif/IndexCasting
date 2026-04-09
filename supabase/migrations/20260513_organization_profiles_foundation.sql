-- ============================================================================
-- Organization Profile Foundation
-- 2026-05-13
--
-- Adds two new tables for internal-only org profile pages (Phase 1).
-- No existing tables, policies, or functions are modified.
--
-- Tables created:
--   public.organization_profiles      — core profile data (1:1 with organizations)
--   public.organization_profile_media — gallery / cover images per org
--
-- New SECURITY DEFINER helpers:
--   public.is_org_owner(p_org_id uuid)
--   public.model_can_read_agency_org_profile(p_organization_id uuid)
--
-- Access model:
--   - Org members (owner + booker/employee): SELECT their own org profile
--   - Owner only: INSERT / UPDATE their own org profile & media
--   - Owner only: INSERT / UPDATE / DELETE org profile media
--   - Models: SELECT agency profile ONLY when they are represented, applied,
--             or have an active recruiting thread with that agency
--   - Admin: full access via is_current_user_admin() (FOR ALL — safe for admin-only)
--   - No cross-org access; no public access in this phase
--
-- RLS safety checklist:
--   [x] No profiles.is_admin in policies — uses is_current_user_admin()
--   [x] No FOR ALL on tables in profiles→models SELECT path
--       (both new tables are NOT referenced by any existing profiles/models policy)
--   [x] No email-matching in policies
--   [x] All SECURITY DEFINER functions have SET row_security TO off
--   [x] 3-layer guards in model_can_read_agency_org_profile
--   [x] LIMIT 1 only for sub-resource lookup after agency guard (documented)
--   [x] No self-referencing policies
-- ============================================================================


-- ── TABLE: organization_profiles ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.organization_profiles (
  organization_id  uuid        PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  logo_url         text,
  description      text,
  address_line_1   text,
  city             text,
  postal_code      text,
  country          text,
  website_url      text,
  contact_email    text,
  contact_phone    text,
  slug             text        UNIQUE,  -- nullable; reserved for future public routes
  is_public        boolean     NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.organization_profiles ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.organization_profiles IS
  'Internal-only org profile data. One row per organization. '
  'is_public=false until a future phase enables public sharing.';


-- ── TABLE: organization_profile_media ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.organization_profile_media (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  media_type        text        NOT NULL
                                CHECK (media_type IN ('client_gallery', 'agency_model_cover')),
  model_id          uuid        REFERENCES public.models(id) ON DELETE SET NULL,
  title             text,
  image_url         text        NOT NULL,
  gender_group      text        CHECK (gender_group IN ('female', 'male')),
  sort_order        integer     NOT NULL DEFAULT 0,
  is_visible_public boolean     NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.organization_profile_media ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.organization_profile_media IS
  'Gallery / cover images attached to an org profile. '
  'media_type=''client_gallery'' for client campaign content; '
  'media_type=''agency_model_cover'' for agency model cover images. '
  'Internal-only in Phase 1 (is_visible_public=false default).';


-- ── HELPER: is_org_owner ─────────────────────────────────────────────────────
--
-- Returns true if the current session user is the owner_id of the given org.
-- Used in INSERT / UPDATE / DELETE policies to restrict writes to owners only.
-- SECURITY DEFINER + row_security=off: avoids RLS cycles when called from policies.

CREATE OR REPLACE FUNCTION public.is_org_owner(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organizations
    WHERE id = p_org_id
      AND owner_id = auth.uid()
  );
$$;

REVOKE ALL    ON FUNCTION public.is_org_owner(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.is_org_owner(uuid) TO authenticated;

COMMENT ON FUNCTION public.is_org_owner IS
  'Returns true if the current user is the owner of the given org. '
  'Used in INSERT/UPDATE/DELETE RLS policies for organization_profiles and '
  'organization_profile_media. SECURITY DEFINER with row_security=off.';


-- ── HELPER: model_can_read_agency_org_profile ─────────────────────────────────
--
-- Returns true for model users who have a valid relationship with the agency
-- that owns the given organization. Three valid relationships:
--   1. The model is represented by that agency (model_agency_territories)
--   2. The model has an active application with that agency (model_applications)
--   3. There is an active recruiting thread linking model and agency
--
-- GUARD ORDER:
--   Auth guard  → agency-type guard (org must be an agency org)
--   → model-record guard (caller must be a linked model)
--   → relationship check (one of the three paths above)
--
-- LIMIT 1 for model lookup: sub-resource lookup AFTER the agency guard has been
-- verified. One user_id maps to at most one models row. Safe to use LIMIT 1 here.
-- (Documented exception per system-invariants.mdc KEINE IMPLIZITE ORG-AUFLÖSUNG)

CREATE OR REPLACE FUNCTION public.model_can_read_agency_org_profile(p_organization_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_agency_id uuid;
  v_model_id  uuid;
BEGIN
  -- Guard 1: authentication
  IF auth.uid() IS NULL THEN
    RETURN false;
  END IF;

  -- Guard 2: resolve agency_id — org must be an agency type with a linked agency record
  SELECT o.agency_id
    INTO v_agency_id
    FROM public.organizations o
   WHERE o.id = p_organization_id
     AND o.type = 'agency'
     AND o.agency_id IS NOT NULL;

  IF v_agency_id IS NULL THEN
    RETURN false; -- not an agency org or no linked agency record
  END IF;

  -- Guard 3: caller must be a linked model user
  -- Sub-resource lookup: one user → at most one model profile. LIMIT 1 is safe here.
  SELECT id
    INTO v_model_id
    FROM public.models
   WHERE user_id = auth.uid()
   LIMIT 1;

  IF v_model_id IS NULL THEN
    RETURN false; -- caller is not a model
  END IF;

  -- Relationship check 1: model is represented by this agency in at least one territory
  IF EXISTS (
    SELECT 1
      FROM public.model_agency_territories
     WHERE model_id = v_model_id
       AND agency_id = v_agency_id
  ) THEN
    RETURN true;
  END IF;

  -- Relationship check 2: model has a non-rejected application with this agency
  IF EXISTS (
    SELECT 1
      FROM public.model_applications
     WHERE applicant_user_id = auth.uid()
       AND agency_id = v_agency_id
       AND status != 'rejected'
  ) THEN
    RETURN true;
  END IF;

  -- Relationship check 3: active recruiting thread between model and agency
  IF EXISTS (
    SELECT 1
      FROM public.recruiting_chat_threads rct
      JOIN public.model_applications ma ON ma.id = rct.application_id
     WHERE rct.agency_id = v_agency_id
       AND ma.applicant_user_id = auth.uid()
  ) THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

REVOKE ALL    ON FUNCTION public.model_can_read_agency_org_profile(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.model_can_read_agency_org_profile(uuid) TO authenticated;

COMMENT ON FUNCTION public.model_can_read_agency_org_profile IS
  'Returns true if the calling model user has a valid relationship with the agency '
  'that owns the given organization. Checks: (1) represented via model_agency_territories, '
  '(2) active application via model_applications, (3) recruiting thread via '
  'recruiting_chat_threads. Models cannot browse all agency profiles globally. '
  'SECURITY DEFINER with row_security=off.';


-- ── RLS POLICIES: organization_profiles ──────────────────────────────────────

-- Admin: full access (FOR ALL is safe for admin-only policies per project rules)
CREATE POLICY "op_admin_all"
  ON public.organization_profiles
  FOR ALL
  TO authenticated
  USING (public.is_current_user_admin())
  WITH CHECK (public.is_current_user_admin());

-- Org members (owner + booker/employee): read their own org profile
CREATE POLICY "op_member_select"
  ON public.organization_profiles
  FOR SELECT
  TO authenticated
  USING (public.is_org_member(organization_id));

-- Owner only: create their org profile row
CREATE POLICY "op_owner_insert"
  ON public.organization_profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_org_owner(organization_id));

-- Owner only: update their org profile
CREATE POLICY "op_owner_update"
  ON public.organization_profiles
  FOR UPDATE
  TO authenticated
  USING (public.is_org_owner(organization_id))
  WITH CHECK (public.is_org_owner(organization_id));

-- Models: read agency profiles when a valid relationship exists
CREATE POLICY "op_model_agency_select"
  ON public.organization_profiles
  FOR SELECT
  TO authenticated
  USING (public.model_can_read_agency_org_profile(organization_id));


-- ── RLS POLICIES: organization_profile_media ─────────────────────────────────

-- Admin: full access
CREATE POLICY "opm_admin_all"
  ON public.organization_profile_media
  FOR ALL
  TO authenticated
  USING (public.is_current_user_admin())
  WITH CHECK (public.is_current_user_admin());

-- Org members: read their own org media
CREATE POLICY "opm_member_select"
  ON public.organization_profile_media
  FOR SELECT
  TO authenticated
  USING (public.is_org_member(organization_id));

-- Owner only: insert media rows
CREATE POLICY "opm_owner_insert"
  ON public.organization_profile_media
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_org_owner(organization_id));

-- Owner only: update media rows
CREATE POLICY "opm_owner_update"
  ON public.organization_profile_media
  FOR UPDATE
  TO authenticated
  USING (public.is_org_owner(organization_id))
  WITH CHECK (public.is_org_owner(organization_id));

-- Owner only: delete media rows
CREATE POLICY "opm_owner_delete"
  ON public.organization_profile_media
  FOR DELETE
  TO authenticated
  USING (public.is_org_owner(organization_id));

-- Models: read agency org media when they have a valid relationship with that agency
CREATE POLICY "opm_model_agency_select"
  ON public.organization_profile_media
  FOR SELECT
  TO authenticated
  USING (public.model_can_read_agency_org_profile(organization_id));


-- ── POST-DEPLOY VERIFICATION QUERIES (run after migration to confirm) ─────────
--
-- 1. New tables exist with RLS enabled:
--    SELECT tablename, rowsecurity FROM pg_tables
--    WHERE schemaname='public' AND tablename IN ('organization_profiles','organization_profile_media');
--    → Expect: 2 rows, rowsecurity=true
--
-- 2. New functions exist:
--    SELECT routine_name FROM information_schema.routines
--    WHERE routine_schema='public'
--      AND routine_name IN ('is_org_owner','model_can_read_agency_org_profile');
--    → Expect: 2 rows
--
-- 3. Correct policy count per table:
--    SELECT tablename, count(*) FROM pg_policies
--    WHERE tablename IN ('organization_profiles','organization_profile_media')
--    GROUP BY tablename;
--    → Expect: organization_profiles=5, organization_profile_media=6
--
-- 4. No FOR ALL (except admin) on new tables:
--    SELECT tablename, policyname, cmd FROM pg_policies
--    WHERE tablename IN ('organization_profiles','organization_profile_media')
--      AND cmd='ALL' AND policyname NOT LIKE '%admin%';
--    → Expect: 0 rows
--
-- 5. Login smoke test (must not return 42P17):
--    SELECT id, role FROM profiles WHERE id = 'fb0ab854-d0c3-4e09-a39c-269d60246927';
--    → Expect: 1 row, role='admin'
