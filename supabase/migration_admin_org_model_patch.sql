-- =============================================================================
-- Admin Org & Model Control — PATCH v2
--
-- Fixes:
--   • Uses same return-column names as the original migration ('type', not
--     'org_type') so CREATE OR REPLACE never needs a signature change.
--   • Removes REVOKE ALL statements that can abort execution in Supabase.
--   • DROP FUNCTION IF EXISTS guards before every function (idempotent).
--   • Fully idempotent — safe to run multiple times.
--
-- Run in Supabase Dashboard → SQL Editor (paste full file, click Run).
-- =============================================================================

-- ─── 1. Add columns (idempotent) ─────────────────────────────────────────────

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS admin_notes TEXT;

ALTER TABLE public.models
  ADD COLUMN IF NOT EXISTS is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS admin_notes TEXT;

-- ─── 2. RLS policies ─────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "admin_update_org_all" ON public.organizations;
CREATE POLICY "admin_update_org_all"
  ON public.organizations FOR UPDATE TO authenticated
  USING     (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = TRUE))
  WITH CHECK(EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = TRUE));

DROP POLICY IF EXISTS "admin_update_model_all" ON public.models;
CREATE POLICY "admin_update_model_all"
  ON public.models FOR UPDATE TO authenticated
  USING     (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = TRUE))
  WITH CHECK(EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = TRUE));

-- ─── 3. get_my_org_active_status ─────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.get_my_org_active_status();
CREATE FUNCTION public.get_my_org_active_status()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT bool_and(o.is_active)
     FROM public.organization_members m
     JOIN public.organizations o ON o.id = m.organization_id
     WHERE m.user_id = auth.uid()),
    TRUE
  );
$$;
GRANT EXECUTE ON FUNCTION public.get_my_org_active_status() TO authenticated;

-- ─── 4. admin_list_organizations ─────────────────────────────────────────────
-- Uses 'type TEXT' to match the original signature — no return-type change.

DROP FUNCTION IF EXISTS public.admin_list_organizations();
CREATE FUNCTION public.admin_list_organizations()
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
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = TRUE
  ) THEN RAISE EXCEPTION 'Not authorized'; END IF;

  RETURN QUERY
  SELECT
    o.id,
    o.name,
    o.type::text,
    o.owner_id,
    o.is_active,
    o.admin_notes,
    COUNT(m.user_id)::BIGINT,
    o.created_at
  FROM public.organizations o
  LEFT JOIN public.organization_members m ON m.organization_id = o.id
  GROUP BY o.id, o.name, o.type, o.owner_id, o.is_active, o.admin_notes, o.created_at
  ORDER BY o.name;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_list_organizations() TO authenticated;

-- ─── 5. admin_set_org_active ─────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.admin_set_org_active(UUID, BOOLEAN);
CREATE FUNCTION public.admin_set_org_active(p_org_id UUID, p_active BOOLEAN)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = TRUE
  ) THEN RAISE EXCEPTION 'Not authorized'; END IF;

  UPDATE public.organizations SET is_active = p_active WHERE id = p_org_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'org not found: %', p_org_id; END IF;

  INSERT INTO public.admin_logs (admin_id, action, details)
  VALUES (auth.uid(), 'admin_set_org_active',
          jsonb_build_object('org_id', p_org_id, 'is_active', p_active));
  RETURN TRUE;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_set_org_active(UUID, BOOLEAN) TO authenticated;

-- ─── 6. admin_update_org_details ─────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.admin_update_org_details(UUID, TEXT, UUID, TEXT, BOOLEAN);
CREATE FUNCTION public.admin_update_org_details(
  p_org_id       UUID,
  p_name         TEXT    DEFAULT NULL,
  p_new_owner_id UUID    DEFAULT NULL,
  p_admin_notes  TEXT    DEFAULT NULL,
  p_clear_notes  BOOLEAN DEFAULT FALSE
)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  org_kind     public.organization_type;
  old_owner_id UUID;
  demoted_role public.org_member_role;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = TRUE
  ) THEN RAISE EXCEPTION 'Not authorized'; END IF;

  SELECT type INTO org_kind FROM public.organizations WHERE id = p_org_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'org not found: %', p_org_id; END IF;

  IF p_name IS NOT NULL THEN
    UPDATE public.organizations SET name = p_name WHERE id = p_org_id;
  END IF;

  IF p_clear_notes THEN
    UPDATE public.organizations SET admin_notes = NULL WHERE id = p_org_id;
  ELSIF p_admin_notes IS NOT NULL THEN
    UPDATE public.organizations SET admin_notes = p_admin_notes WHERE id = p_org_id;
  END IF;

  IF p_new_owner_id IS NOT NULL THEN
    demoted_role := CASE
      WHEN org_kind = 'agency' THEN 'booker'::public.org_member_role
      ELSE 'employee'::public.org_member_role
    END;

    SELECT user_id INTO old_owner_id
    FROM public.organization_members
    WHERE organization_id = p_org_id AND role = 'owner' LIMIT 1;

    IF old_owner_id IS NOT NULL AND old_owner_id IS DISTINCT FROM p_new_owner_id THEN
      UPDATE public.organization_members SET role = demoted_role
      WHERE organization_id = p_org_id AND user_id = old_owner_id;
    END IF;

    UPDATE public.organization_members SET role = 'owner'
    WHERE organization_id = p_org_id AND user_id = p_new_owner_id;

    UPDATE public.organizations SET owner_id = p_new_owner_id WHERE id = p_org_id;
  END IF;

  INSERT INTO public.admin_logs (admin_id, action, details)
  VALUES (auth.uid(), 'admin_update_org_details',
          jsonb_build_object(
            'org_id', p_org_id,
            'name_updated', (p_name IS NOT NULL),
            'new_owner_id', p_new_owner_id,
            'notes_updated', (p_admin_notes IS NOT NULL OR p_clear_notes)
          ));
  RETURN TRUE;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_update_org_details(UUID, TEXT, UUID, TEXT, BOOLEAN) TO authenticated;

-- ─── 7. admin_list_all_models ────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.admin_list_all_models();
CREATE FUNCTION public.admin_list_all_models()
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
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = TRUE
  ) THEN RAISE EXCEPTION 'Not authorized'; END IF;

  RETURN QUERY
  SELECT m.id, m.name, m.email, m.agency_id, m.user_id,
         m.is_active, m.admin_notes, m.created_at
  FROM public.models m ORDER BY m.name;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_list_all_models() TO authenticated;

-- ─── 8. admin_set_model_active ───────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.admin_set_model_active(UUID, BOOLEAN);
CREATE FUNCTION public.admin_set_model_active(p_model_id UUID, p_active BOOLEAN)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = TRUE
  ) THEN RAISE EXCEPTION 'Not authorized'; END IF;

  UPDATE public.models SET is_active = p_active WHERE id = p_model_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'model not found: %', p_model_id; END IF;

  INSERT INTO public.admin_logs (admin_id, action, details)
  VALUES (auth.uid(), 'admin_set_model_active',
          jsonb_build_object('model_id', p_model_id, 'is_active', p_active));
  RETURN TRUE;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_set_model_active(UUID, BOOLEAN) TO authenticated;

-- ─── 9. admin_update_model_notes ─────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.admin_update_model_notes(UUID, TEXT);
CREATE FUNCTION public.admin_update_model_notes(p_model_id UUID, p_admin_notes TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = TRUE
  ) THEN RAISE EXCEPTION 'Not authorized'; END IF;

  UPDATE public.models SET admin_notes = p_admin_notes WHERE id = p_model_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'model not found: %', p_model_id; END IF;

  INSERT INTO public.admin_logs (admin_id, action, details)
  VALUES (auth.uid(), 'admin_update_model_notes',
          jsonb_build_object('model_id', p_model_id, 'notes_cleared', (p_admin_notes IS NULL)));
  RETURN TRUE;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_update_model_notes(UUID, TEXT) TO authenticated;

-- ─── 10. get_models_by_location — add is_active filter ───────────────────────

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

CREATE FUNCTION public.get_models_by_location(
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
RETURNS SETOF jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT to_jsonb(result) FROM (
    SELECT
      m.*,
      mat.country_code AS territory_country_code,
      a.name           AS agency_name,
      mat.agency_id    AS territory_agency_id
    FROM public.models m
    JOIN public.model_agency_territories mat ON mat.model_id = m.id
    JOIN public.agencies                 a   ON a.id         = mat.agency_id
    WHERE
      mat.country_code = p_iso
      AND m.is_active = TRUE
      AND (m.agency_relationship_status IS NULL
           OR m.agency_relationship_status IN ('active','pending_link'))
      AND (p_client_type = 'all'
           OR (p_client_type = 'fashion'    AND m.is_visible_fashion    = TRUE)
           OR (p_client_type = 'commercial' AND m.is_visible_commercial = TRUE))
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
      AND (p_hair_color IS NULL OR p_hair_color = ''
           OR m.hair_color ILIKE ('%' || p_hair_color || '%'))
      AND (p_city IS NULL OR p_city = '' OR m.city ILIKE p_city)
      AND (p_category IS NULL OR m.categories IS NULL OR m.categories = '{}'
           OR m.categories @> ARRAY[p_category])
      AND (p_ethnicities IS NULL OR array_length(p_ethnicities, 1) IS NULL
           OR m.ethnicity = ANY(p_ethnicities))
    ORDER BY m.name
    OFFSET p_from LIMIT (p_to - p_from + 1)
  ) result;
$$;
GRANT EXECUTE ON FUNCTION public.get_models_by_location(
  text, text, integer, integer, text, text, boolean, boolean,
  integer, integer, text, integer, integer, integer, integer,
  integer, integer, integer, integer, text, text[]
) TO authenticated, anon;
