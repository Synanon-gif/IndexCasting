-- Shadow paths elimination: public roster eligibility + agency-model direct chat MAT gate.
-- No automatic data mutation; stricter read/create guards only.

-- ─── 1. Public agency models — active relationship + (linked account OR MAT) ──
-- Differs from internal roster (which allows pending_link / null status): public web
-- only shows "complete" cards — no half-linked rows without territory or account.

CREATE OR REPLACE FUNCTION public.get_public_agency_models(p_agency_id uuid)
RETURNS TABLE (
  id        uuid,
  name      text,
  sex       text,
  cover_url text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
BEGIN
  IF p_agency_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
    SELECT
      m.id                          AS id,
      m.name::text                  AS name,
      m.sex::text                   AS sex,
      (m.portfolio_images[1])::text AS cover_url
    FROM public.models m
    WHERE m.agency_id = p_agency_id
      AND m.agency_relationship_status = 'active'
      AND (
        m.user_id IS NOT NULL
        OR EXISTS (
          SELECT 1
          FROM public.model_agency_territories mat
          WHERE mat.model_id = m.id
            AND mat.agency_id = p_agency_id
        )
      )
    ORDER BY m.name;
END;
$$;

COMMENT ON FUNCTION public.get_public_agency_models(uuid) IS
  'Public-safe roster: active agency_relationship_status only; model must have user_id OR '
  'model_agency_territories row for this agency (no half-linked public cards).';


-- ─── 2. ensure_agency_model_direct_conversation — MAT required (admin bypass) ─

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

  -- New conversation only: require MAT for this (model_id, agency_id); admin bypass.
  IF NOT public.is_current_user_admin() THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.model_agency_territories mat
      WHERE mat.model_id = p_model_id
        AND mat.agency_id = p_agency_id
    ) THEN
      RAISE EXCEPTION 'no_active_representation';
    END IF;
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

COMMENT ON FUNCTION public.ensure_agency_model_direct_conversation(UUID, UUID) IS
  'Find-or-create agency↔model direct chat. After 20260904: new inserts require model_agency_territories '
  '(model_id, agency_id) unless platform admin; existing row by context_id returns without MAT re-check.';
