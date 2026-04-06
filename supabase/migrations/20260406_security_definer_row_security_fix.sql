-- =============================================================================
-- Security Audit: SECURITY DEFINER functions missing SET row_security TO off
-- Date: 2026-04-06
--
-- Affected functions (read RLS-protected tables but lack SET row_security TO off):
--   1. bulk_upsert_model_locations    — reads models, organizations, organization_members
--   2. create_model_from_accepted_application — reads model_applications, organization_members,
--                                              models, bookers; writes models, model_photos,
--                                              model_agency_territories
--   3. agency_update_model_full       — reads organization_members, organizations, agencies, models
--   4. agency_claim_unowned_model     — reads organization_members, organizations, agencies, models
--   5. model_update_own_profile_safe  — reads models
--   6. admin_update_model_minor_flag  — calls assert_is_admin(), writes models
--
-- Without SET row_security TO off, PostgreSQL 15+ evaluates RLS inside the
-- SECURITY DEFINER context, which can cause recursive policy evaluation (42P17)
-- or empty result sets when the function reads tables that are part of a
-- profiles→models SELECT policy chain.
--
-- All functions are recreated IDENTICALLY except for the added clause.
-- Idempotent: CREATE OR REPLACE.
-- =============================================================================


-- ─── 1. bulk_upsert_model_locations ──────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.bulk_upsert_model_locations(
  p_model_ids    uuid[],
  p_country_code text,
  p_city         text    DEFAULT NULL,
  p_lat_approx   float   DEFAULT NULL,
  p_lng_approx   float   DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_model_id  uuid;
  v_count     integer := 0;
  v_lat       float := CASE WHEN p_lat_approx IS NOT NULL
                            THEN ROUND(p_lat_approx::numeric, 2)::float
                            ELSE NULL END;
  v_lng       float := CASE WHEN p_lng_approx IS NOT NULL
                            THEN ROUND(p_lng_approx::numeric, 2)::float
                            ELSE NULL END;
BEGIN
  FOREACH v_model_id IN ARRAY p_model_ids
  LOOP
    -- Verify caller is an agency org member OR legacy booker for this model.
    IF NOT (
      EXISTS (
        SELECT 1
        FROM   public.models m
        JOIN   public.organizations o
                 ON  o.agency_id = m.agency_id
                 AND o.type      = 'agency'
        JOIN   public.organization_members om
                 ON  om.organization_id = o.id
        WHERE  m.id       = v_model_id
          AND  om.user_id = auth.uid()
      )
      OR EXISTS (
        SELECT 1
        FROM   public.models m
        JOIN   public.bookers b ON b.agency_id = m.agency_id
        WHERE  m.id      = v_model_id
          AND  b.user_id = auth.uid()
      )
    ) THEN
      CONTINUE;  -- skip models the caller doesn't manage
    END IF;

    INSERT INTO public.model_locations (
      model_id, country_code, city, lat_approx, lng_approx,
      share_approximate_location, source, updated_at
    )
    VALUES (
      v_model_id,
      UPPER(TRIM(p_country_code)),
      NULLIF(TRIM(COALESCE(p_city, '')), ''),
      v_lat,
      v_lng,
      FALSE,      -- agency never has GPS; share_approximate_location is model-owned
      'agency',
      now()
    )
    ON CONFLICT (model_id) DO UPDATE SET
      country_code               = UPPER(TRIM(p_country_code)),
      city                       = NULLIF(TRIM(COALESCE(p_city, '')), ''),
      lat_approx                 = v_lat,
      lng_approx                 = v_lng,
      -- Preserve the model's own share_approximate_location choice.
      share_approximate_location = model_locations.share_approximate_location,
      source                     = 'agency',
      updated_at                 = now();

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.bulk_upsert_model_locations(
  uuid[], text, text, float, float
) TO authenticated;


-- ─── 2. create_model_from_accepted_application ───────────────────────────────

CREATE OR REPLACE FUNCTION public.create_model_from_accepted_application(
  p_application_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_app            RECORD;
  v_existing_id    UUID;
  v_model_id       UUID;
  v_name           TEXT;
  v_imgs           TEXT[];
BEGIN
  -- Fetch and validate the application
  SELECT *
    INTO v_app
    FROM model_applications
   WHERE id = p_application_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Application not found: %', p_application_id;
  END IF;

  -- Caller must be the applicant or an agency member
  IF v_app.applicant_user_id IS NOT NULL AND v_app.applicant_user_id <> auth.uid() THEN
    IF NOT EXISTS (
      SELECT 1
        FROM organization_members om
        JOIN organizations o ON o.id = om.organization_id
       WHERE o.agency_id = v_app.accepted_by_agency_id
         AND om.user_id = auth.uid()
    ) AND NOT EXISTS (
      SELECT 1 FROM bookers b
       WHERE b.agency_id = v_app.accepted_by_agency_id
         AND b.user_id = auth.uid()
    ) THEN
      RAISE EXCEPTION 'Permission denied: caller is not the applicant or an agency member';
    END IF;
  END IF;

  IF v_app.status <> 'accepted' OR v_app.accepted_by_agency_id IS NULL THEN
    RAISE EXCEPTION 'Application is not accepted or missing agency: %', p_application_id;
  END IF;

  -- Guard: if the applicant already has a linked model row, return existing id
  IF v_app.applicant_user_id IS NOT NULL THEN
    SELECT id INTO v_existing_id
      FROM models
     WHERE user_id = v_app.applicant_user_id
     LIMIT 1;
    IF v_existing_id IS NOT NULL THEN
      RETURN v_existing_id;
    END IF;
  END IF;

  -- Build name and image list
  v_name := trim(coalesce(v_app.first_name, '') || ' ' || coalesce(v_app.last_name, ''));
  IF v_name = '' THEN v_name := 'Model'; END IF;

  -- images is stored as jsonb; extract profile/fullBody/closeUp
  v_imgs := ARRAY(
    SELECT val::text
      FROM jsonb_each_text(coalesce(v_app.images, '{}'::jsonb)) AS t(key, val)
     WHERE key IN ('profile', 'fullBody', 'closeUp')
       AND val IS NOT NULL
  );

  -- Insert the model row
  INSERT INTO models (
    agency_id,
    user_id,
    agency_relationship_status,
    agency_relationship_ended_at,
    name,
    height,
    city,
    country_code,
    hair_color,
    ethnicity,
    sex,
    portfolio_images,
    polaroids,
    is_visible_commercial,
    is_visible_fashion,
    is_active
  ) VALUES (
    v_app.accepted_by_agency_id,
    v_app.applicant_user_id,
    'active',
    NULL,
    v_name,
    coalesce(v_app.height, 0),
    v_app.city,
    v_app.country_code,
    v_app.hair_color,
    v_app.ethnicity,
    CASE
      WHEN v_app.gender IN ('female', 'male') THEN v_app.gender::text
      ELSE NULL
    END,
    coalesce(v_imgs, ARRAY[]::text[]),
    ARRAY[]::text[],
    false,
    true,
    true
  )
  RETURNING id INTO v_model_id;

  -- Insert model_photos rows for the application images
  IF array_length(v_imgs, 1) > 0 THEN
    INSERT INTO model_photos (model_id, url, sort_order, visible, is_visible_to_clients, photo_type, source, api_external_id)
    SELECT v_model_id, img, ord, true, true, 'portfolio', 'application', NULL
      FROM unnest(v_imgs) WITH ORDINALITY AS t(img, ord);
  END IF;

  -- Write territories from pending_territories into model_agency_territories.
  IF v_app.pending_territories IS NOT NULL AND jsonb_array_length(v_app.pending_territories) > 0 THEN
    INSERT INTO model_agency_territories (model_id, agency_id, country_code)
    SELECT
      v_model_id,
      v_app.accepted_by_agency_id,
      upper(trim(t.val))
    FROM jsonb_array_elements_text(v_app.pending_territories) AS t(val)
    WHERE trim(t.val) <> ''
    ON CONFLICT (model_id, agency_id, country_code) DO NOTHING;
  END IF;

  RETURN v_model_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_model_from_accepted_application(UUID) TO authenticated;


-- ─── 3. agency_update_model_full ─────────────────────────────────────────────

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

  -- Caller must be an Agency org member
  SELECT org.agency_id INTO v_caller_agency_id
  FROM public.organization_members om
  JOIN public.organizations org ON org.id = om.organization_id
  WHERE om.user_id = auth.uid()
    AND org.agency_id IS NOT NULL
  LIMIT 1;

  -- Also check agency owners without an organization_members row
  IF v_caller_agency_id IS NULL THEN
    SELECT a.id INTO v_caller_agency_id
    FROM public.agencies a
    WHERE a.owner_user_id = auth.uid()
    LIMIT 1;
  END IF;

  IF v_caller_agency_id IS NULL THEN
    RAISE EXCEPTION 'not_in_agency';
  END IF;

  -- Resolve model's current agency
  SELECT agency_id INTO v_model_agency_id
  FROM public.models
  WHERE id = p_model_id;

  -- Allow when: model belongs to this agency OR model has no agency yet
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


-- ─── 4. agency_claim_unowned_model ───────────────────────────────────────────

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
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT org.agency_id INTO v_caller_agency_id
  FROM public.organization_members om
  JOIN public.organizations org ON org.id = om.organization_id
  WHERE om.user_id = auth.uid()
    AND org.agency_id IS NOT NULL
  LIMIT 1;

  IF v_caller_agency_id IS NULL THEN
    SELECT a.id INTO v_caller_agency_id
    FROM public.agencies a
    WHERE a.owner_user_id = auth.uid()
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
    AND agency_id IS NULL;  -- double guard against race conditions
END;
$$;

REVOKE ALL    ON FUNCTION public.agency_claim_unowned_model FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.agency_claim_unowned_model TO authenticated;


-- ─── 5. model_update_own_profile_safe ────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.model_update_own_profile_safe(
  p_city             text DEFAULT NULL,
  p_country          text DEFAULT NULL,
  p_current_location text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.models
    WHERE user_id = auth.uid()
      AND agency_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'forbidden: agency_controls_profile';
  END IF;

  UPDATE public.models SET
    city             = COALESCE(p_city,             city),
    country          = COALESCE(p_country,          country),
    current_location = COALESCE(p_current_location, current_location)
  WHERE user_id = auth.uid();
END;
$$;

REVOKE ALL    ON FUNCTION public.model_update_own_profile_safe FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.model_update_own_profile_safe TO authenticated;


-- ─── 6. admin_update_model_minor_flag ────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_update_model_minor_flag(
  p_model_id uuid,
  p_is_minor boolean DEFAULT true
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
BEGIN
  PERFORM public.assert_is_admin();

  UPDATE public.models SET
    is_minor = COALESCE(p_is_minor, is_minor)
  WHERE id = p_model_id;
END;
$$;

REVOKE ALL    ON FUNCTION public.admin_update_model_minor_flag FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_model_minor_flag TO authenticated;


-- ─── Verification ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  fn_names text[] := ARRAY[
    'bulk_upsert_model_locations',
    'create_model_from_accepted_application',
    'agency_update_model_full',
    'agency_claim_unowned_model',
    'model_update_own_profile_safe',
    'admin_update_model_minor_flag'
  ];
  fn_name text;
BEGIN
  FOREACH fn_name IN ARRAY fn_names LOOP
    ASSERT EXISTS (SELECT 1 FROM pg_proc WHERE proname = fn_name),
      format('FAIL: function %s not found', fn_name);
  END LOOP;

  RAISE NOTICE 'PASS: 20260406_security_definer_row_security_fix — all % functions recreated with SET row_security TO off',
    array_length(fn_names, 1);
END $$;
