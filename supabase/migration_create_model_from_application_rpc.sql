-- K-2: SECURITY DEFINER RPC für createModelFromApplication
-- Ermöglicht es dem Bewerber (model-User), nach Annahme einen models-Datensatz anzulegen,
-- ohne dass der Aufrufer Mitglied der Agentur sein muss (RLS-kompatibel).

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

  -- Caller must be the applicant (or an admin/booker — relaxed for accept flow)
  IF v_app.applicant_user_id IS NOT NULL AND v_app.applicant_user_id <> auth.uid() THEN
    -- Allow agency members to call this too (they accept the application)
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

  -- Insert the model row with SECURITY DEFINER (bypasses agency-member INSERT RLS)
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
    sex,
    portfolio_images,
    polaroids,
    is_visible_commercial,
    is_visible_fashion
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
    CASE
      WHEN v_app.gender IN ('female', 'male') THEN v_app.gender::text
      ELSE NULL
    END,
    coalesce(v_imgs, ARRAY[]::text[]),
    ARRAY[]::text[],
    false,
    true
  )
  RETURNING id INTO v_model_id;

  -- Insert model_photos rows for the application images
  IF array_length(v_imgs, 1) > 0 THEN
    INSERT INTO model_photos (model_id, url, sort_order, visible, is_visible_to_clients, photo_type, source, api_external_id)
    SELECT v_model_id, img, ord, true, true, 'portfolio', 'application', NULL
      FROM unnest(v_imgs) WITH ORDINALITY AS t(img, ord);
  END IF;

  RETURN v_model_id;
END;
$$;

-- Grant to authenticated users (RLS enforced inside the function)
GRANT EXECUTE ON FUNCTION public.create_model_from_accepted_application(UUID) TO authenticated;
