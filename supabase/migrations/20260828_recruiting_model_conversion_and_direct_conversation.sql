-- =============================================================================
-- 20260828: Recruiting → represented model — conversion + agency↔model chat
--
-- 1) create_model_from_accepted_application
--    - Existing models row (same applicant user_id): merge MAT from
--      pending_territories, sync email from profiles, set active relationship,
--      align agency_id with accepting agency (matches INSERT path semantics).
--    - New row: include email from profiles on INSERT.
--    - Fail closed if territories were promised but no MAT row exists for the
--      accepting agency after merge.
--
-- 2) ensure_agency_model_direct_conversation(p_agency_id, p_model_id)
--    SECURITY DEFINER: find-or-create conversations row with
--    context_id = agency-model:{agencyId}:{modelId} so models can bootstrap
--    without client INSERT RLS (agency_organization_id).
--
-- Idempotent. Deploy via supabase-push-verify-migration.sh.
-- =============================================================================

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
  v_prof_email     TEXT;
  v_mat_count      INT;
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

      IF array_length(v_imgs, 1) > 0
         AND NOT EXISTS (
           SELECT 1 FROM public.model_photos mp
           WHERE mp.model_id = v_model_id AND mp.photo_type = 'portfolio'
         )
      THEN
        INSERT INTO public.model_photos (
          model_id, url, sort_order, visible, is_visible_to_clients,
          photo_type, source, api_external_id
        )
        SELECT v_model_id, img, ord, true, true, 'portfolio', 'application', NULL
        FROM unnest(v_imgs) WITH ORDINALITY AS t(img, ord);
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
$$;

REVOKE ALL    ON FUNCTION public.create_model_from_accepted_application(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_model_from_accepted_application(UUID) TO authenticated;

COMMENT ON FUNCTION public.create_model_from_accepted_application(UUID) IS
  '20260828: Merge path when models.user_id already exists — MAT + email + active relationship; '
  'INSERT path sets email from profiles; fail closed if pending_territories not applied.';


-- ─── ensure_agency_model_direct_conversation ─────────────────────────────────

CREATE OR REPLACE FUNCTION public.ensure_agency_model_direct_conversation(
  p_agency_id UUID,
  p_model_id  UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_uid            UUID := auth.uid();
  v_ctx            TEXT;
  v_conv_id        UUID;
  v_org_id         UUID;
  v_agency_name    TEXT;
  v_model_user     UUID;
  v_rep_user       UUID;
  v_parts          UUID[];
  v_ok_model       BOOLEAN;
  v_ok_agency      BOOLEAN;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF p_agency_id IS NULL OR p_model_id IS NULL THEN
    RAISE EXCEPTION 'invalid_params';
  END IF;

  SELECT m.user_id INTO v_model_user
  FROM public.models m
  WHERE m.id = p_model_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'model_not_found';
  END IF;

  v_ok_model := (v_model_user IS NOT NULL AND v_model_user = v_uid);

  SELECT EXISTS (
    SELECT 1
    FROM public.organization_members om
    JOIN public.organizations o ON o.id = om.organization_id
    WHERE o.agency_id = p_agency_id
      AND o.type = 'agency'
      AND om.user_id = v_uid
  ) OR EXISTS (
    SELECT 1 FROM public.bookers b
    WHERE b.agency_id = p_agency_id AND b.user_id = v_uid
  ) INTO v_ok_agency;

  IF NOT v_ok_model AND NOT v_ok_agency THEN
    RAISE EXCEPTION 'access_denied';
  END IF;

  v_ctx := 'agency-model:' || p_agency_id::text || ':' || p_model_id::text;

  SELECT c.id INTO v_conv_id
  FROM public.conversations c
  WHERE c.context_id = v_ctx
  LIMIT 1;

  IF v_conv_id IS NOT NULL THEN
    RETURN v_conv_id;
  END IF;

  SELECT o.id INTO v_org_id
  FROM public.organizations o
  WHERE o.agency_id = p_agency_id
    AND o.type = 'agency'
  ORDER BY o.created_at ASC
  LIMIT 1;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'agency_org_not_found';
  END IF;

  SELECT a.name INTO v_agency_name
  FROM public.agencies a
  WHERE a.id = p_agency_id
  LIMIT 1;

  SELECT om.user_id INTO v_rep_user
  FROM public.organization_members om
  WHERE om.organization_id = v_org_id
  ORDER BY om.created_at ASC
  LIMIT 1;

  IF v_rep_user IS NULL THEN
    SELECT b.user_id INTO v_rep_user
    FROM public.bookers b
    WHERE b.agency_id = p_agency_id
    ORDER BY b.created_at ASC NULLS LAST
    LIMIT 1;
  END IF;

  IF v_rep_user IS NULL THEN
    RAISE EXCEPTION 'no_agency_representative_for_chat';
  END IF;

  IF v_model_user IS NOT NULL THEN
    IF v_model_user = v_rep_user THEN
      v_parts := ARRAY[v_rep_user];
    ELSE
      v_parts := ARRAY[v_model_user, v_rep_user];
    END IF;
  ELSE
    v_parts := ARRAY[v_rep_user];
  END IF;

  INSERT INTO public.conversations (
    type,
    context_id,
    participant_ids,
    agency_organization_id,
    title,
    created_by
  ) VALUES (
    'direct'::public.conversation_type,
    v_ctx,
    v_parts,
    v_org_id,
    coalesce(v_agency_name, ''),
    v_uid
  )
  RETURNING id INTO v_conv_id;

  RETURN v_conv_id;
EXCEPTION
  WHEN unique_violation THEN
    SELECT c.id INTO v_conv_id
    FROM public.conversations c
    WHERE c.context_id = v_ctx
    LIMIT 1;
    IF v_conv_id IS NULL THEN
      RAISE;
    END IF;
    RETURN v_conv_id;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_agency_model_direct_conversation(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_agency_model_direct_conversation(UUID, UUID) TO authenticated;

COMMENT ON FUNCTION public.ensure_agency_model_direct_conversation(UUID, UUID) IS
  '20260828: Find-or-create agency↔model direct conversation (context_id agency-model:…); '
  'callable by linked model user or agency member; bypasses client INSERT RLS.';
