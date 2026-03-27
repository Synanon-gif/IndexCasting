-- =============================================================================
-- Admin Org & Model Control
--
-- Adds is_active + admin_notes to organizations and models.
-- Adds SECURITY DEFINER RPCs for admin control over orgs and models.
-- Adds a helper RPC for the org-deactivation gate in AuthContext.
-- Updates get_models_by_location to filter by models.is_active.
--
-- Run after Phase 9 migrations (migration_rls_fix_profiles_email.sql).
-- =============================================================================

-- ─── 1. Schema changes ────────────────────────────────────────────────────────

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS admin_notes TEXT;

ALTER TABLE public.models
  ADD COLUMN IF NOT EXISTS is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS admin_notes TEXT;

-- ─── 2. Column-level security: admin_notes is admin-only ─────────────────────
-- PostgREST (Supabase) respects column-level privileges: select=* will simply
-- omit revoked columns rather than returning an error, so existing client-side
-- queries with .select('*') on models remain fully functional.

REVOKE SELECT (admin_notes) ON TABLE public.organizations FROM authenticated, anon;
REVOKE SELECT (admin_notes) ON TABLE public.models        FROM authenticated, anon;

-- ─── 3. RLS: admin override for organizations ─────────────────────────────────
-- Admin can UPDATE any column (is_active, name, owner_id, admin_notes).
-- Existing owner-can-update-name policy stays in place.

DROP POLICY IF EXISTS "admin_update_org_all" ON public.organizations;
CREATE POLICY "admin_update_org_all"
  ON public.organizations
  FOR UPDATE
  TO authenticated
  USING     (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = TRUE))
  WITH CHECK(EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = TRUE));

-- ─── 4. RLS: admin override for models ────────────────────────────────────────

DROP POLICY IF EXISTS "admin_update_model_all" ON public.models;
CREATE POLICY "admin_update_model_all"
  ON public.models
  FOR UPDATE
  TO authenticated
  USING     (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = TRUE))
  WITH CHECK(EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = TRUE));

-- ─── 5. Helper RPC: check caller's own org active status ──────────────────────
-- Used in AuthContext.loadProfile to gate deactivated-org users.
-- Returns TRUE  if all of the caller's orgs are active (or caller has no orgs).
-- Returns FALSE if any org the caller belongs to has is_active = false.

CREATE OR REPLACE FUNCTION public.get_my_org_active_status()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY INVOKER  -- runs as caller's session; respects RLS
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT bool_and(o.is_active)
      FROM public.organization_members m
      JOIN public.organizations o ON o.id = m.organization_id
      WHERE m.user_id = auth.uid()
    ),
    TRUE
  );
$$;

REVOKE ALL   ON FUNCTION public.get_my_org_active_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_org_active_status() TO authenticated;

-- ─── 6. SECURITY DEFINER RPCs for admin operations ───────────────────────────

-- 6a. admin_list_organizations — returns all orgs with admin_notes
CREATE OR REPLACE FUNCTION public.admin_list_organizations()
RETURNS TABLE(
  id           UUID,
  name         TEXT,
  type         TEXT,
  owner_id     UUID,
  is_active    BOOLEAN,
  admin_notes  TEXT,
  member_count BIGINT,
  created_at   TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN QUERY
  SELECT
    o.id,
    o.name,
    o.type::text,
    o.owner_id,
    o.is_active,
    o.admin_notes,
    COUNT(m.user_id)::BIGINT AS member_count,
    o.created_at
  FROM public.organizations o
  LEFT JOIN public.organization_members m ON m.organization_id = o.id
  GROUP BY o.id, o.name, o.type, o.owner_id, o.is_active, o.admin_notes, o.created_at
  ORDER BY o.name;
END;
$$;

REVOKE ALL   ON FUNCTION public.admin_list_organizations() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_organizations() TO authenticated;

-- 6b. admin_set_org_active
CREATE OR REPLACE FUNCTION public.admin_set_org_active(
  p_org_id UUID,
  p_active  BOOLEAN
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  UPDATE public.organizations SET is_active = p_active WHERE id = p_org_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'organization not found: %', p_org_id;
  END IF;

  INSERT INTO public.admin_logs (admin_id, action, details)
  VALUES (
    auth.uid(),
    'admin_set_org_active',
    jsonb_build_object('org_id', p_org_id, 'is_active', p_active)
  );

  RETURN TRUE;
END;
$$;

REVOKE ALL   ON FUNCTION public.admin_set_org_active(UUID, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_org_active(UUID, BOOLEAN) TO authenticated;

-- 6c. admin_update_org_details — name, owner transfer, admin_notes in one call
CREATE OR REPLACE FUNCTION public.admin_update_org_details(
  p_org_id       UUID,
  p_name         TEXT    DEFAULT NULL,
  p_new_owner_id UUID    DEFAULT NULL,
  p_admin_notes  TEXT    DEFAULT NULL,
  p_clear_notes  BOOLEAN DEFAULT FALSE
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  org_kind     public.organization_type;
  old_owner_id UUID;
  demoted_role public.org_member_role;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT type INTO org_kind FROM public.organizations WHERE id = p_org_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'organization not found: %', p_org_id;
  END IF;

  -- Update name if provided
  IF p_name IS NOT NULL THEN
    UPDATE public.organizations SET name = p_name WHERE id = p_org_id;
  END IF;

  -- Update admin_notes (p_clear_notes=TRUE clears it; p_admin_notes≠NULL sets it)
  IF p_clear_notes THEN
    UPDATE public.organizations SET admin_notes = NULL WHERE id = p_org_id;
  ELSIF p_admin_notes IS NOT NULL THEN
    UPDATE public.organizations SET admin_notes = p_admin_notes WHERE id = p_org_id;
  END IF;

  -- Owner transfer
  IF p_new_owner_id IS NOT NULL THEN
    demoted_role := CASE
      WHEN org_kind = 'agency' THEN 'booker'::public.org_member_role
      ELSE                          'employee'::public.org_member_role
    END;

    SELECT user_id INTO old_owner_id
    FROM public.organization_members
    WHERE organization_id = p_org_id AND role = 'owner'
    LIMIT 1;

    IF old_owner_id IS NOT NULL AND old_owner_id IS DISTINCT FROM p_new_owner_id THEN
      UPDATE public.organization_members
      SET role = demoted_role
      WHERE organization_id = p_org_id AND user_id = old_owner_id;
    END IF;

    UPDATE public.organization_members
    SET role = 'owner'
    WHERE organization_id = p_org_id AND user_id = p_new_owner_id;

    UPDATE public.organizations
    SET owner_id = p_new_owner_id
    WHERE id = p_org_id;
  END IF;

  INSERT INTO public.admin_logs (admin_id, action, details)
  VALUES (
    auth.uid(),
    'admin_update_org_details',
    jsonb_build_object(
      'org_id',        p_org_id,
      'name_updated',  (p_name IS NOT NULL),
      'new_owner_id',  p_new_owner_id,
      'notes_updated', (p_admin_notes IS NOT NULL OR p_clear_notes)
    )
  );

  RETURN TRUE;
END;
$$;

REVOKE ALL   ON FUNCTION public.admin_update_org_details(UUID, TEXT, UUID, TEXT, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_update_org_details(UUID, TEXT, UUID, TEXT, BOOLEAN) TO authenticated;

-- 6d. admin_list_all_models — returns all models with admin_notes
CREATE OR REPLACE FUNCTION public.admin_list_all_models()
RETURNS TABLE(
  id          UUID,
  name        TEXT,
  email       TEXT,
  agency_id   UUID,
  user_id     UUID,
  is_active   BOOLEAN,
  admin_notes TEXT,
  created_at  TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN QUERY
  SELECT m.id, m.name, m.email, m.agency_id, m.user_id, m.is_active, m.admin_notes, m.created_at
  FROM public.models m
  ORDER BY m.name;
END;
$$;

REVOKE ALL   ON FUNCTION public.admin_list_all_models() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_all_models() TO authenticated;

-- 6e. admin_set_model_active
CREATE OR REPLACE FUNCTION public.admin_set_model_active(
  p_model_id UUID,
  p_active   BOOLEAN
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  UPDATE public.models SET is_active = p_active WHERE id = p_model_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'model not found: %', p_model_id;
  END IF;

  INSERT INTO public.admin_logs (admin_id, action, details)
  VALUES (
    auth.uid(),
    'admin_set_model_active',
    jsonb_build_object('model_id', p_model_id, 'is_active', p_active)
  );

  RETURN TRUE;
END;
$$;

REVOKE ALL   ON FUNCTION public.admin_set_model_active(UUID, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_model_active(UUID, BOOLEAN) TO authenticated;

-- 6f. admin_update_model_notes
CREATE OR REPLACE FUNCTION public.admin_update_model_notes(
  p_model_id    UUID,
  p_admin_notes TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  UPDATE public.models SET admin_notes = p_admin_notes WHERE id = p_model_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'model not found: %', p_model_id;
  END IF;

  INSERT INTO public.admin_logs (admin_id, action, details)
  VALUES (
    auth.uid(),
    'admin_update_model_notes',
    jsonb_build_object('model_id', p_model_id, 'notes_cleared', (p_admin_notes IS NULL))
  );

  RETURN TRUE;
END;
$$;

REVOKE ALL   ON FUNCTION public.admin_update_model_notes(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_update_model_notes(UUID, TEXT) TO authenticated;

-- ─── 7. Update get_models_by_location RPC: filter by models.is_active ─────────
-- Adds AND m.is_active = TRUE so deactivated models are hidden from discovery.
-- This replaces migration_get_models_by_location_rpc_v2.sql (idempotent).

DROP FUNCTION IF EXISTS public.get_models_by_location(
  text, text, integer, integer, text, text, boolean, boolean,
  integer, integer, text, integer, integer, integer, integer,
  integer, integer, integer, integer, text
);
DROP FUNCTION IF EXISTS public.get_models_by_location(
  text, text, integer, integer, text, text, boolean, boolean,
  integer, integer, text, integer, integer, integer, integer,
  integer, integer, integer, integer, text, text[]
);

CREATE OR REPLACE FUNCTION public.get_models_by_location(
  p_iso             text,
  p_client_type     text      DEFAULT 'all',
  p_from            integer   DEFAULT 0,
  p_to              integer   DEFAULT 999,
  p_city            text      DEFAULT NULL,
  p_category        text      DEFAULT NULL,
  p_sports_winter   boolean   DEFAULT FALSE,
  p_sports_summer   boolean   DEFAULT FALSE,
  p_height_min      integer   DEFAULT NULL,
  p_height_max      integer   DEFAULT NULL,
  p_hair_color      text      DEFAULT NULL,
  p_hips_min        integer   DEFAULT NULL,
  p_hips_max        integer   DEFAULT NULL,
  p_waist_min       integer   DEFAULT NULL,
  p_waist_max       integer   DEFAULT NULL,
  p_chest_min       integer   DEFAULT NULL,
  p_chest_max       integer   DEFAULT NULL,
  p_legs_inseam_min integer   DEFAULT NULL,
  p_legs_inseam_max integer   DEFAULT NULL,
  p_sex             text      DEFAULT NULL,
  p_ethnicities     text[]    DEFAULT NULL
)
RETURNS SETOF jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT to_jsonb(result)
  FROM (
    SELECT
      m.*,
      mat.country_code  AS territory_country_code,
      a.name            AS agency_name,
      mat.agency_id     AS territory_agency_id
    FROM public.models m
    JOIN public.model_agency_territories mat ON mat.model_id = m.id
    JOIN public.agencies                 a   ON a.id         = mat.agency_id
    WHERE
      mat.country_code = p_iso
      AND m.is_active = TRUE
      AND (
        m.agency_relationship_status IS NULL
        OR m.agency_relationship_status IN ('active', 'pending_link')
      )
      AND (
        p_client_type = 'all'
        OR (p_client_type = 'fashion'    AND m.is_visible_fashion    = TRUE)
        OR (p_client_type = 'commercial' AND m.is_visible_commercial = TRUE)
      )
      AND (NOT p_sports_winter OR m.is_sports_winter = TRUE)
      AND (NOT p_sports_summer OR m.is_sports_summer = TRUE)
      AND (p_height_min      IS NULL OR m.height      >= p_height_min)
      AND (p_height_max      IS NULL OR m.height      <= p_height_max)
      AND (p_hips_min        IS NULL OR m.hips        >= p_hips_min)
      AND (p_hips_max        IS NULL OR m.hips        <= p_hips_max)
      AND (p_waist_min       IS NULL OR m.waist       >= p_waist_min)
      AND (p_waist_max       IS NULL OR m.waist       <= p_waist_max)
      AND (p_chest_min       IS NULL OR m.chest       >= p_chest_min)
      AND (p_chest_max       IS NULL OR m.chest       <= p_chest_max)
      AND (p_legs_inseam_min IS NULL OR m.legs_inseam >= p_legs_inseam_min)
      AND (p_legs_inseam_max IS NULL OR m.legs_inseam <= p_legs_inseam_max)
      AND (p_sex             IS NULL OR m.sex         =  p_sex)
      AND (
        p_hair_color IS NULL OR p_hair_color = ''
        OR m.hair_color ILIKE ('%' || p_hair_color || '%')
      )
      AND (
        p_city IS NULL OR p_city = ''
        OR m.city ILIKE p_city
      )
      AND (
        p_category IS NULL
        OR m.categories IS NULL
        OR m.categories = '{}'
        OR m.categories @> ARRAY[p_category]
      )
      AND (
        p_ethnicities IS NULL
        OR array_length(p_ethnicities, 1) IS NULL
        OR m.ethnicity = ANY(p_ethnicities)
      )
    ORDER BY m.name
    OFFSET p_from
    LIMIT  (p_to - p_from + 1)
  ) result;
$$;

GRANT EXECUTE ON FUNCTION public.get_models_by_location(
  text, text, integer, integer, text, text, boolean, boolean,
  integer, integer, text, integer, integer, integer, integer,
  integer, integer, integer, integer, text, text[]
) TO authenticated, anon;
