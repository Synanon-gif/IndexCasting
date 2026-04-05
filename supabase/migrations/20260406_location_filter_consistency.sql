-- =============================================================================
-- Migration: Location & Filter Consistency
-- Date: 2026-04-06
--
-- Fixes:
-- 1. bulk_upsert_model_locations: agency-writes no longer force
--    share_approximate_location = TRUE. Agency never has GPS coordinates;
--    share_approximate_location is the model's own privacy decision.
--    INSERT: FALSE (no GPS from agency)
--    ON CONFLICT: preserve existing value (model may have enabled it via GPS)
--
-- 2. create_model_from_accepted_application: adds ethnicity field and writes
--    pending_territories into model_agency_territories after model creation,
--    so application-path models appear in client territory-based discovery.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) bulk_upsert_model_locations — agency-only
--    share_approximate_location ownership fix:
--    - INSERT new rows with FALSE (agency has no GPS)
--    - ON CONFLICT: preserve existing share_approximate_location (model may have
--      already enabled it via their own GPS consent in ModelProfileScreen)
-- ---------------------------------------------------------------------------
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
      -- If the model had enabled GPS sharing, the agency city-update must not disable it.
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


-- ---------------------------------------------------------------------------
-- 2) create_model_from_accepted_application v2
--    Additions vs v1:
--    a) ethnicity is copied from model_applications (added in migration_add_ethnicity.sql)
--    b) pending_territories are written to model_agency_territories so the model
--       appears in client territory-based discovery immediately after acceptance.
--    c) is_active is explicitly set to TRUE (ensure client-discovery finds the model).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_model_from_accepted_application(
  p_application_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
  -- Without territories the model will not appear in client territory-based discovery
  -- (get_models_by_location / get_discovery_models both JOIN model_agency_territories).
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

-- Grant to authenticated users (RLS enforced inside the function)
GRANT EXECUTE ON FUNCTION public.create_model_from_accepted_application(UUID) TO authenticated;
