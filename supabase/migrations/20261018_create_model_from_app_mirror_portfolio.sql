-- Migration: ensure application photos reach agency-visible model
-- Issue: in the "existing model" branch of create_model_from_accepted_application,
-- the RPC inserted model_photos rows but never mirrored the URLs onto
-- public.models.portfolio_images. Discovery, packages, swipe and several
-- agency UIs read the mirror first → empty cards even though model_photos
-- contained the rows. The "new model" branch already wrote both.
--
-- This migration replaces the RPC with logic that:
--   1. preserves all existing guards / signatures (no signature change)
--   2. in the existing-model branch, when no portfolio model_photos exist yet
--      AND the application carries images, inserts them into model_photos AND
--      mirrors them into models.portfolio_images (only if mirror is empty/null
--      to avoid clobbering model self-edits).
--   3. keeps the new-model branch behaviour unchanged.
--
-- Anti-regression: keeps SECURITY DEFINER, SET row_security TO off,
-- SET search_path = public, and all auth/membership/MAT guards.

CREATE OR REPLACE FUNCTION public.create_model_from_accepted_application(p_application_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET row_security TO 'off'
AS $function$
DECLARE
  v_app            RECORD;
  v_existing_id    UUID;
  v_model_id       UUID;
  v_name           TEXT;
  v_imgs           TEXT[];
  v_prof_email     TEXT;
  v_mat_count      INT;
  v_existing_portfolio_count INT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT * INTO v_app
  FROM public.model_applications
  WHERE id = p_application_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Application not found: %', p_application_id;
  END IF;

  IF v_app.applicant_user_id IS NOT NULL AND v_app.applicant_user_id <> auth.uid() THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.organization_members om
      JOIN public.organizations o ON o.id = om.organization_id
      WHERE o.agency_id = v_app.accepted_by_agency_id
        AND om.user_id  = auth.uid()
    ) AND NOT EXISTS (
      SELECT 1 FROM public.bookers b
      WHERE b.agency_id = v_app.accepted_by_agency_id
        AND b.user_id   = auth.uid()
    ) THEN
      RAISE EXCEPTION 'Permission denied: caller is not the applicant or an agency member';
    END IF;
  END IF;

  IF v_app.status <> 'accepted' OR v_app.accepted_by_agency_id IS NULL THEN
    RAISE EXCEPTION 'Application is not accepted or missing agency: %', p_application_id;
  END IF;

  SELECT email INTO v_prof_email
  FROM public.profiles
  WHERE id = v_app.applicant_user_id
  LIMIT 1;

  v_name := trim(coalesce(v_app.first_name, '') || ' ' || coalesce(v_app.last_name, ''));
  IF v_name = '' THEN v_name := 'Model'; END IF;

  v_imgs := ARRAY(
    SELECT val::text
    FROM jsonb_each_text(coalesce(v_app.images, '{}'::jsonb)) AS t(key, val)
    WHERE key IN ('profile', 'fullBody', 'closeUp')
      AND val IS NOT NULL
  );

  -- ─── Existing linked model row: merge representation (MAT + roster fields) ───
  IF v_app.applicant_user_id IS NOT NULL THEN
    SELECT id INTO v_existing_id
    FROM public.models
    WHERE user_id = v_app.applicant_user_id
    LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
      v_model_id := v_existing_id;

      UPDATE public.models
      SET
        agency_id = v_app.accepted_by_agency_id,
        agency_relationship_status = 'active',
        agency_relationship_ended_at = NULL,
        email = COALESCE(email, NULLIF(trim(v_prof_email), '')),
        name = CASE
          WHEN trim(coalesce(name, '')) = '' THEN v_name
          ELSE name
        END,
        height = CASE
          WHEN height IS NULL OR height = 0 THEN coalesce(v_app.height, 0)
          ELSE height
        END,
        city = COALESCE(city, v_app.city),
        country_code = COALESCE(country_code, v_app.country_code),
        hair_color = COALESCE(hair_color, v_app.hair_color),
        ethnicity = COALESCE(ethnicity, v_app.ethnicity),
        sex = COALESCE(
          sex,
          CASE WHEN v_app.gender IN ('female', 'male') THEN v_app.gender::text ELSE NULL END
        )
      WHERE id = v_model_id;

      -- Application photos → model_photos (canonical) AND mirror (discovery)
      -- Only when model has no portfolio photos yet, so we never clobber
      -- existing media that the agency or model curated.
      SELECT count(*)::INT INTO v_existing_portfolio_count
      FROM public.model_photos mp
      WHERE mp.model_id = v_model_id AND mp.photo_type = 'portfolio';

      IF array_length(v_imgs, 1) > 0 AND COALESCE(v_existing_portfolio_count, 0) = 0 THEN
        INSERT INTO public.model_photos (
          model_id, url, sort_order, visible, is_visible_to_clients,
          photo_type, source, api_external_id
        )
        SELECT v_model_id, img, ord, true, true, 'portfolio', 'application', NULL
        FROM unnest(v_imgs) WITH ORDINALITY AS t(img, ord);

        -- Mirror onto models.portfolio_images only if the mirror is empty —
        -- model self-edits or earlier curated arrays must not be overwritten.
        UPDATE public.models
        SET portfolio_images = v_imgs
        WHERE id = v_model_id
          AND (portfolio_images IS NULL OR array_length(portfolio_images, 1) IS NULL);
      END IF;

      IF v_app.pending_territories IS NOT NULL
         AND jsonb_array_length(v_app.pending_territories) > 0
      THEN
        INSERT INTO public.model_agency_territories (model_id, agency_id, country_code)
        SELECT
          v_model_id,
          v_app.accepted_by_agency_id,
          upper(trim(t.val))
        FROM jsonb_array_elements_text(v_app.pending_territories) AS t(val)
        WHERE trim(t.val) <> ''
        ON CONFLICT (model_id, country_code)
        DO UPDATE SET agency_id = EXCLUDED.agency_id;
      END IF;

      IF v_app.pending_territories IS NOT NULL
         AND jsonb_array_length(v_app.pending_territories) > 0
      THEN
        SELECT count(*)::INT INTO v_mat_count
        FROM public.model_agency_territories mat
        WHERE mat.model_id = v_model_id
          AND mat.agency_id = v_app.accepted_by_agency_id;

        IF v_mat_count IS NULL OR v_mat_count < 1 THEN
          RAISE EXCEPTION 'representation_territories_not_applied';
        END IF;
      END IF;

      RETURN v_model_id;
    END IF;
  END IF;

  -- ─── New model row ───
  INSERT INTO public.models (
    agency_id, user_id, agency_relationship_status, agency_relationship_ended_at,
    email,
    name, height, city, country_code, hair_color, ethnicity, sex,
    portfolio_images, polaroids, is_visible_commercial, is_visible_fashion, is_active
  ) VALUES (
    v_app.accepted_by_agency_id,
    v_app.applicant_user_id,
    'active', NULL,
    NULLIF(trim(v_prof_email), ''),
    v_name,
    coalesce(v_app.height, 0),
    v_app.city,
    v_app.country_code,
    v_app.hair_color,
    v_app.ethnicity,
    CASE WHEN v_app.gender IN ('female', 'male') THEN v_app.gender::text ELSE NULL END,
    coalesce(v_imgs, ARRAY[]::text[]),
    ARRAY[]::text[],
    false, true, true
  )
  RETURNING id INTO v_model_id;

  IF array_length(v_imgs, 1) > 0 THEN
    INSERT INTO public.model_photos (
      model_id, url, sort_order, visible, is_visible_to_clients,
      photo_type, source, api_external_id
    )
    SELECT v_model_id, img, ord, true, true, 'portfolio', 'application', NULL
    FROM unnest(v_imgs) WITH ORDINALITY AS t(img, ord);
  END IF;

  IF v_app.pending_territories IS NOT NULL AND jsonb_array_length(v_app.pending_territories) > 0 THEN
    INSERT INTO public.model_agency_territories (model_id, agency_id, country_code)
    SELECT
      v_model_id,
      v_app.accepted_by_agency_id,
      upper(trim(t.val))
    FROM jsonb_array_elements_text(v_app.pending_territories) AS t(val)
    WHERE trim(t.val) <> ''
    ON CONFLICT (model_id, country_code)
    DO UPDATE SET agency_id = EXCLUDED.agency_id;
  END IF;

  IF v_app.pending_territories IS NOT NULL
     AND jsonb_array_length(v_app.pending_territories) > 0
  THEN
    SELECT count(*)::INT INTO v_mat_count
    FROM public.model_agency_territories mat
    WHERE mat.model_id = v_model_id
      AND mat.agency_id = v_app.accepted_by_agency_id;

    IF v_mat_count IS NULL OR v_mat_count < 1 THEN
      RAISE EXCEPTION 'representation_territories_not_applied';
    END IF;
  END IF;

  RETURN v_model_id;
END;
$function$;
