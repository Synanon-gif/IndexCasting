-- =============================================================================
-- Fix: Remove references to agencies.owner_user_id (column does not exist)
-- Date: 2026-04-27
--
-- PROBLEM:
--   Multiple SECURITY DEFINER RPCs used `public.agencies.owner_user_id` as a
--   legacy fallback. The column is not present on production schema (agencies
--   rows are keyed by organization_members / bookers). Runtime error:
--   column "owner_user_id" does not exist — breaks territory save and related flows.
--
-- FIX:
--   Authorization for a target agency_id uses ONLY:
--     1) organization_members JOIN organizations WHERE type = 'agency' AND agency_id match
--     2) public.bookers (legacy booker logins)
--   Admin bypass: is_current_user_admin() unchanged.
--
-- Replaces definitive bodies from 20260416 (territories), 20260422 (roster read),
-- 20260424 (generate_model_claim_token), 20260412 (agency_update / claim_unowned).
-- Idempotent: CREATE OR REPLACE.
-- =============================================================================

-- ─── 1. save_model_territories ───────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.save_model_territories(
  p_model_id      uuid,
  p_agency_id     uuid,
  p_country_codes text[]
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_code     text;
  v_org_id   uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF NOT public.is_current_user_admin() THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.organization_members om
      JOIN public.organizations o ON o.id = om.organization_id
      WHERE om.user_id  = v_uid
        AND o.agency_id = p_agency_id
        AND o.type      = 'agency'
    ) AND NOT EXISTS (
      SELECT 1 FROM public.bookers b
      WHERE b.agency_id = p_agency_id AND b.user_id = v_uid
    ) THEN
      RAISE EXCEPTION 'not_authorized';
    END IF;
  END IF;

  SELECT id INTO v_org_id
  FROM public.organizations
  WHERE type      = 'agency'
    AND agency_id = p_agency_id
  ORDER BY created_at ASC
  LIMIT 1;

  DELETE FROM public.model_agency_territories t
  WHERE t.model_id  = p_model_id
    AND t.agency_id = p_agency_id;

  IF v_org_id IS NOT NULL THEN
    DELETE FROM public.model_assignments ma
    WHERE ma.model_id        = p_model_id
      AND ma.organization_id = v_org_id;
  END IF;

  IF p_country_codes IS NOT NULL THEN
    FOREACH v_code IN ARRAY p_country_codes LOOP
      v_code := upper(trim(v_code));
      CONTINUE WHEN v_code = '';

      INSERT INTO public.model_agency_territories (model_id, agency_id, country_code, territory)
      VALUES (p_model_id, p_agency_id, v_code, v_code)
      ON CONFLICT ON CONSTRAINT model_agency_territories_one_agency_per_territory
      DO UPDATE SET agency_id = EXCLUDED.agency_id,
                    territory  = EXCLUDED.territory;

      IF v_org_id IS NOT NULL THEN
        INSERT INTO public.model_assignments (model_id, organization_id, territory, role)
        VALUES (p_model_id, v_org_id, v_code, 'non_exclusive')
        ON CONFLICT ON CONSTRAINT model_assignments_unique_model_territory
        DO UPDATE SET organization_id = EXCLUDED.organization_id;
      END IF;
    END LOOP;
  END IF;

  RETURN TRUE;
END;
$$;

REVOKE ALL    ON FUNCTION public.save_model_territories(uuid, uuid, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_model_territories(uuid, uuid, text[]) TO authenticated;

COMMENT ON FUNCTION public.save_model_territories IS
  'FIXED (20260427): org_members + organizations.type=agency + bookers; no agencies.owner_user_id. '
  'Dual-write model_agency_territories + model_assignments.';


-- ─── 2. bulk_add_model_territories ───────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.bulk_add_model_territories(
  p_model_ids     uuid[],
  p_agency_id     uuid,
  p_country_codes text[]
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_normalized text[];
  v_org_id     uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF NOT public.is_current_user_admin() THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.organization_members om
      JOIN public.organizations o ON o.id = om.organization_id
      WHERE om.user_id   = auth.uid()
        AND o.agency_id  = p_agency_id
        AND o.type       = 'agency'
    ) AND NOT EXISTS (
      SELECT 1 FROM public.bookers b
      WHERE b.agency_id = p_agency_id AND b.user_id = auth.uid()
    ) THEN
      RAISE EXCEPTION 'not_in_agency';
    END IF;
  END IF;

  SELECT ARRAY(
    SELECT DISTINCT upper(trim(c))
    FROM unnest(p_country_codes) AS c
    WHERE trim(c) <> ''
  ) INTO v_normalized;

  IF array_length(v_normalized, 1) IS NULL OR array_length(p_model_ids, 1) IS NULL THEN
    RETURN TRUE;
  END IF;

  SELECT id INTO v_org_id
  FROM public.organizations
  WHERE type      = 'agency'
    AND agency_id = p_agency_id
  ORDER BY created_at ASC
  LIMIT 1;

  INSERT INTO public.model_agency_territories (model_id, agency_id, country_code, territory)
  SELECT m.id, p_agency_id, c.code, c.code
  FROM unnest(p_model_ids)       AS m(id)
  CROSS JOIN unnest(v_normalized) AS c(code)
  ON CONFLICT ON CONSTRAINT model_agency_territories_one_agency_per_territory
  DO UPDATE SET agency_id = EXCLUDED.agency_id,
                territory  = EXCLUDED.territory;

  IF v_org_id IS NOT NULL THEN
    INSERT INTO public.model_assignments (model_id, organization_id, territory, role)
    SELECT m.id, v_org_id, c.code, 'non_exclusive'
    FROM unnest(p_model_ids)       AS m(id)
    CROSS JOIN unnest(v_normalized) AS c(code)
    ON CONFLICT ON CONSTRAINT model_assignments_unique_model_territory
    DO UPDATE SET organization_id = EXCLUDED.organization_id;
  END IF;

  RETURN TRUE;
END;
$$;

REVOKE ALL    ON FUNCTION public.bulk_add_model_territories(uuid[], uuid, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bulk_add_model_territories(uuid[], uuid, text[]) TO authenticated;

COMMENT ON FUNCTION public.bulk_add_model_territories IS
  'FIXED (20260427): org_members + type=agency + bookers; no agencies.owner_user_id.';


-- ─── 3. bulk_save_model_territories ──────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.bulk_save_model_territories(
  p_model_ids     uuid[],
  p_agency_id     uuid,
  p_country_codes text[]
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_normalized text[];
  v_org_id     uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF NOT public.is_current_user_admin() THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.organization_members om
      JOIN public.organizations o ON o.id = om.organization_id
      WHERE om.user_id   = auth.uid()
        AND o.agency_id  = p_agency_id
        AND o.type       = 'agency'
    ) AND NOT EXISTS (
      SELECT 1 FROM public.bookers b
      WHERE b.agency_id = p_agency_id AND b.user_id = auth.uid()
    ) THEN
      RAISE EXCEPTION 'not_in_agency';
    END IF;
  END IF;

  SELECT ARRAY(
    SELECT DISTINCT upper(trim(c))
    FROM unnest(p_country_codes) AS c
    WHERE trim(c) <> ''
  ) INTO v_normalized;

  IF array_length(p_model_ids, 1) IS NULL THEN
    RETURN TRUE;
  END IF;

  SELECT id INTO v_org_id
  FROM public.organizations
  WHERE type      = 'agency'
    AND agency_id = p_agency_id
  ORDER BY created_at ASC
  LIMIT 1;

  DELETE FROM public.model_agency_territories t
  WHERE t.model_id  = ANY(p_model_ids)
    AND t.agency_id = p_agency_id;

  IF v_org_id IS NOT NULL THEN
    DELETE FROM public.model_assignments ma
    WHERE ma.model_id        = ANY(p_model_ids)
      AND ma.organization_id = v_org_id;
  END IF;

  IF array_length(v_normalized, 1) IS NOT NULL THEN
    INSERT INTO public.model_agency_territories (model_id, agency_id, country_code, territory)
    SELECT m.id, p_agency_id, c.code, c.code
    FROM unnest(p_model_ids)       AS m(id)
    CROSS JOIN unnest(v_normalized) AS c(code)
    ON CONFLICT ON CONSTRAINT model_agency_territories_one_agency_per_territory
    DO UPDATE SET agency_id = EXCLUDED.agency_id,
                  territory  = EXCLUDED.territory;

    IF v_org_id IS NOT NULL THEN
      INSERT INTO public.model_assignments (model_id, organization_id, territory, role)
      SELECT m.id, v_org_id, c.code, 'non_exclusive'
      FROM unnest(p_model_ids)       AS m(id)
      CROSS JOIN unnest(v_normalized) AS c(code)
      ON CONFLICT ON CONSTRAINT model_assignments_unique_model_territory
      DO UPDATE SET organization_id = EXCLUDED.organization_id;
    END IF;
  END IF;

  RETURN TRUE;
END;
$$;

REVOKE ALL    ON FUNCTION public.bulk_save_model_territories(uuid[], uuid, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bulk_save_model_territories(uuid[], uuid, text[]) TO authenticated;

COMMENT ON FUNCTION public.bulk_save_model_territories IS
  'FIXED (20260427): org_members + type=agency + bookers; no agencies.owner_user_id.';


-- ─── 4. get_territories_for_agency_roster ────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_territories_for_agency_roster(
  p_agency_id uuid
)
RETURNS TABLE (
  r_model_id     uuid,
  r_country_code text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF NOT public.is_current_user_admin() THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.organization_members om
      JOIN public.organizations o ON o.id = om.organization_id
      WHERE om.user_id  = auth.uid()
        AND o.agency_id = p_agency_id
        AND o.type      = 'agency'
    ) AND NOT EXISTS (
      SELECT 1 FROM public.bookers
      WHERE agency_id = p_agency_id AND user_id = auth.uid()
    ) THEN
      RAISE EXCEPTION 'not_in_agency';
    END IF;
  END IF;

  RETURN QUERY
    SELECT
      mat.model_id,
      mat.country_code AS r_country_code
    FROM public.model_agency_territories mat
    WHERE mat.agency_id = p_agency_id
    ORDER BY mat.country_code;
END;
$$;

REVOKE ALL ON FUNCTION public.get_territories_for_agency_roster(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_territories_for_agency_roster(uuid) TO authenticated;

COMMENT ON FUNCTION public.get_territories_for_agency_roster IS
  'FIXED (20260427): MAT.country_code; guard org_members + type=agency + bookers; no agencies.owner_user_id.';


-- ─── 5. generate_model_claim_token(uuid, uuid) ─────────────────────────────

CREATE OR REPLACE FUNCTION public.generate_model_claim_token(
  p_model_id uuid,
  p_organization_id uuid DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_caller_agency_id  uuid;
  v_model_agency_id   uuid;
  v_token             text;
  v_allowed           boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT agency_id INTO v_model_agency_id
  FROM public.models WHERE id = p_model_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'model_not_found';
  END IF;

  IF v_model_agency_id IS NOT NULL THEN
    v_allowed := (
      EXISTS (
        SELECT 1
        FROM public.organization_members om
        JOIN public.organizations org ON org.id = om.organization_id
        WHERE om.user_id = auth.uid()
          AND org.type = 'agency'
          AND org.agency_id = v_model_agency_id
      )
      OR EXISTS (
        SELECT 1 FROM public.bookers b
        WHERE b.agency_id = v_model_agency_id AND b.user_id = auth.uid()
      )
    );
    IF NOT v_allowed THEN
      RAISE EXCEPTION 'model_not_in_agency';
    END IF;
    v_caller_agency_id := v_model_agency_id;
  ELSE
    IF p_organization_id IS NOT NULL THEN
      SELECT o.agency_id INTO v_caller_agency_id
      FROM public.organization_members om
      JOIN public.organizations o ON o.id = om.organization_id
      WHERE om.user_id = auth.uid()
        AND o.id = p_organization_id
        AND o.type = 'agency'
        AND o.agency_id IS NOT NULL;

      IF v_caller_agency_id IS NULL THEN
        RAISE EXCEPTION 'not_member_of_organization';
      END IF;
    ELSE
      SELECT org.agency_id INTO v_caller_agency_id
      FROM public.organization_members om
      JOIN public.organizations org ON org.id = om.organization_id
      WHERE om.user_id = auth.uid()
        AND org.agency_id IS NOT NULL
        AND org.type = 'agency'
      ORDER BY om.created_at ASC
      LIMIT 1;

      IF v_caller_agency_id IS NULL THEN
        SELECT b.agency_id INTO v_caller_agency_id
        FROM public.bookers b
        WHERE b.user_id = auth.uid()
        ORDER BY b.created_at ASC
        LIMIT 1;
      END IF;

      IF v_caller_agency_id IS NULL THEN
        RAISE EXCEPTION 'not_in_agency';
      END IF;
    END IF;
  END IF;

  DELETE FROM public.model_claim_tokens
  WHERE model_id = p_model_id
    AND used_at IS NULL
    AND expires_at > now();

  v_token := encode(gen_random_bytes(32), 'hex');

  INSERT INTO public.model_claim_tokens (token, model_id, agency_id)
  VALUES (v_token, p_model_id, v_caller_agency_id);

  RETURN v_token;
END;
$$;

REVOKE ALL ON FUNCTION public.generate_model_claim_token(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_model_claim_token(uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.generate_model_claim_token(uuid, uuid) IS
  'FIXED (20260427): agency access via org_members + type=agency + bookers; no agencies.owner_user_id.';


-- ─── 6. agency_update_model_full ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.agency_update_model_full(
  p_model_id                     uuid,
  p_name                         text        DEFAULT NULL,
  p_email                        text        DEFAULT NULL,
  p_phone                        text        DEFAULT NULL,
  p_city                         text        DEFAULT NULL,
  p_country                      text        DEFAULT NULL,
  p_country_code                 text        DEFAULT NULL,
  p_current_location             text        DEFAULT NULL,
  p_height                       integer     DEFAULT NULL,
  p_bust                         integer     DEFAULT NULL,
  p_waist                        integer     DEFAULT NULL,
  p_hips                         integer     DEFAULT NULL,
  p_chest                        integer     DEFAULT NULL,
  p_legs_inseam                  integer     DEFAULT NULL,
  p_shoe_size                    integer     DEFAULT NULL,
  p_hair_color                   text        DEFAULT NULL,
  p_eye_color                    text        DEFAULT NULL,
  p_sex                          text        DEFAULT NULL,
  p_ethnicity                    text        DEFAULT NULL,
  p_categories                   text[]      DEFAULT NULL,
  p_is_visible_fashion           boolean     DEFAULT NULL,
  p_is_visible_commercial        boolean     DEFAULT NULL,
  p_is_active                    boolean     DEFAULT NULL,
  p_is_sports_winter             boolean     DEFAULT NULL,
  p_is_sports_summer             boolean     DEFAULT NULL,
  p_portfolio_images             text[]      DEFAULT NULL,
  p_polaroids                    text[]      DEFAULT NULL,
  p_video_url                    text        DEFAULT NULL,
  p_polas_source                 text        DEFAULT NULL,
  p_show_polas_on_profile        boolean     DEFAULT NULL,
  p_agency_relationship_status   text        DEFAULT NULL,
  p_agency_relationship_ended_at timestamptz DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_caller_agency_id uuid;
  v_model_agency_id  uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT org.agency_id INTO v_caller_agency_id
  FROM public.organization_members om
  JOIN public.organizations org ON org.id = om.organization_id
  WHERE om.user_id = auth.uid()
    AND org.agency_id IS NOT NULL
    AND org.type = 'agency'
  ORDER BY om.created_at ASC
  LIMIT 1;

  IF v_caller_agency_id IS NULL THEN
    SELECT b.agency_id INTO v_caller_agency_id
    FROM public.bookers b
    WHERE b.user_id = auth.uid()
    ORDER BY b.created_at ASC
    LIMIT 1;
  END IF;

  IF v_caller_agency_id IS NULL THEN
    RAISE EXCEPTION 'not_in_agency';
  END IF;

  SELECT agency_id INTO v_model_agency_id
  FROM public.models
  WHERE id = p_model_id;

  IF v_model_agency_id IS NOT NULL AND v_model_agency_id != v_caller_agency_id THEN
    RAISE EXCEPTION 'model_not_in_agency';
  END IF;

  UPDATE public.models SET
    name                         = COALESCE(p_name,                         name),
    email                        = COALESCE(p_email,                        email),
    phone                        = COALESCE(p_phone,                        phone),
    city                         = COALESCE(p_city,                         city),
    country                      = COALESCE(p_country,                      country),
    country_code                 = COALESCE(p_country_code,                 country_code),
    current_location             = COALESCE(p_current_location,             current_location),
    height                       = COALESCE(p_height,                       height),
    bust                         = COALESCE(p_bust,                         bust),
    waist                        = COALESCE(p_waist,                        waist),
    hips                         = COALESCE(p_hips,                         hips),
    chest                        = COALESCE(p_chest,                        chest),
    legs_inseam                  = COALESCE(p_legs_inseam,                  legs_inseam),
    shoe_size                    = COALESCE(p_shoe_size,                    shoe_size),
    hair_color                   = COALESCE(p_hair_color,                   hair_color),
    eye_color                    = COALESCE(p_eye_color,                    eye_color),
    sex                          = COALESCE(p_sex,                          sex),
    ethnicity                    = COALESCE(p_ethnicity,                    ethnicity),
    categories                   = CASE
                                     WHEN p_categories IS NULL THEN categories
                                     WHEN array_length(p_categories, 1) IS NULL THEN NULL
                                     ELSE p_categories
                                   END,
    is_visible_fashion           = COALESCE(p_is_visible_fashion,           is_visible_fashion),
    is_visible_commercial        = COALESCE(p_is_visible_commercial,        is_visible_commercial),
    is_active                    = COALESCE(p_is_active,                    is_active),
    is_sports_winter             = COALESCE(p_is_sports_winter,             is_sports_winter),
    is_sports_summer             = COALESCE(p_is_sports_summer,             is_sports_summer),
    portfolio_images             = COALESCE(p_portfolio_images,             portfolio_images),
    polaroids                    = COALESCE(p_polaroids,                    polaroids),
    video_url                    = COALESCE(p_video_url,                    video_url),
    polas_source                 = COALESCE(p_polas_source,                 polas_source),
    show_polas_on_profile        = COALESCE(p_show_polas_on_profile,        show_polas_on_profile),
    agency_relationship_status   = COALESCE(p_agency_relationship_status,   agency_relationship_status),
    agency_relationship_ended_at = COALESCE(p_agency_relationship_ended_at, agency_relationship_ended_at)
  WHERE id = p_model_id;
END;
$$;

REVOKE ALL    ON FUNCTION public.agency_update_model_full FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.agency_update_model_full TO authenticated;

COMMENT ON FUNCTION public.agency_update_model_full IS
  'FIXED (20260427): caller agency via org_members type=agency + bookers; no agencies.owner_user_id.';


-- ─── 7. agency_claim_unowned_model ───────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.agency_claim_unowned_model(
  p_model_id                     uuid,
  p_agency_relationship_status   text    DEFAULT 'active',
  p_is_visible_fashion           boolean DEFAULT true,
  p_is_visible_commercial        boolean DEFAULT true
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_caller_agency_id uuid;
  v_model_agency_id  uuid;
  v_row_count        integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT org.agency_id INTO v_caller_agency_id
  FROM public.organization_members om
  JOIN public.organizations org ON org.id = om.organization_id
  WHERE om.user_id = auth.uid()
    AND org.agency_id IS NOT NULL
    AND org.type = 'agency'
  ORDER BY om.created_at ASC
  LIMIT 1;

  IF v_caller_agency_id IS NULL THEN
    SELECT b.agency_id INTO v_caller_agency_id
    FROM public.bookers b
    WHERE b.user_id = auth.uid()
    ORDER BY b.created_at ASC
    LIMIT 1;
  END IF;

  IF v_caller_agency_id IS NULL THEN
    RAISE EXCEPTION 'not_in_agency';
  END IF;

  SELECT agency_id INTO v_model_agency_id
  FROM public.models
  WHERE id = p_model_id;

  IF v_model_agency_id IS NOT NULL THEN
    RAISE EXCEPTION 'model_already_claimed';
  END IF;

  UPDATE public.models SET
    agency_id                    = v_caller_agency_id,
    agency_relationship_status   = COALESCE(p_agency_relationship_status, 'active'),
    agency_relationship_ended_at = NULL,
    is_visible_fashion           = COALESCE(p_is_visible_fashion, true),
    is_visible_commercial        = COALESCE(p_is_visible_commercial, true)
  WHERE id = p_model_id
    AND agency_id IS NULL;

  GET DIAGNOSTICS v_row_count = ROW_COUNT;
  IF v_row_count = 0 THEN
    RAISE EXCEPTION 'model_already_claimed'
      USING HINT = 'Another agency claimed this model concurrently.';
  END IF;
END;
$$;

REVOKE ALL    ON FUNCTION public.agency_claim_unowned_model FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.agency_claim_unowned_model TO authenticated;

COMMENT ON FUNCTION public.agency_claim_unowned_model IS
  'FIXED (20260427): caller agency via org_members type=agency + bookers; no agencies.owner_user_id.';


-- ─── Verification ────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'save_model_territories',
        'bulk_add_model_territories',
        'bulk_save_model_territories',
        'get_territories_for_agency_roster',
        'generate_model_claim_token',
        'agency_update_model_full',
        'agency_claim_unowned_model'
      )
      AND pg_get_functiondef(p.oid) ILIKE '%owner_user_id%'
  ) THEN
    RAISE EXCEPTION 'FAIL: at least one fixed function still references owner_user_id';
  END IF;

  RAISE NOTICE 'PASS: 20260427_fix_agency_guard_no_owner_user_id — roster + territories + claim + agency RPCs';
END $$;
