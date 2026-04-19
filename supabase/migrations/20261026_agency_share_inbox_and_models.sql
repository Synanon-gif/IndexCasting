-- =============================================================================
-- 20261026_agency_share_inbox_and_models.sql
--
-- Agency-to-Agency Roster Share — recipient inbox + model-list RPCs.
--
-- 1) public.get_agency_share_inbox(p_organization_id uuid)
--    Returns all guest_links rows with purpose='agency_share' targeted at the
--    caller's agency (resolved via p_organization_id membership).
--
-- 2) public.get_agency_share_models(p_link_id uuid)
--    Recipient-side counterpart to get_guest_link_models — same return shape,
--    no rate limit, no first_accessed_at consumption (recipient can revisit).
--    Auth: caller must be a member of an agency org whose agency_id matches
--    the link's target_agency_id.
--
-- Both functions are SECURITY DEFINER + row_security=off with explicit
-- caller-scope guards. Read-only.
--
-- Idempotent function definitions. Single migration; not deployed via root
-- supabase/*.sql.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) get_agency_share_inbox
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_agency_share_inbox(uuid);

CREATE OR REPLACE FUNCTION public.get_agency_share_inbox(
  p_organization_id uuid
)
RETURNS TABLE(
  link_id              uuid,
  sender_agency_id     uuid,
  sender_agency_name   text,
  model_count          integer,
  label                text,
  type                 text,
  expires_at           timestamptz,
  is_active            boolean,
  created_at           timestamptz,
  first_accessed_at    timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_caller            uuid;
  v_recipient_agency  uuid;
BEGIN
  v_caller := auth.uid();
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'organization_id_required';
  END IF;

  SELECT o.agency_id INTO v_recipient_agency
  FROM public.organization_members om
  JOIN public.organizations o ON o.id = om.organization_id
  WHERE om.user_id = v_caller
    AND om.organization_id = p_organization_id
    AND o.type = 'agency'
    AND o.agency_id IS NOT NULL;

  IF v_recipient_agency IS NULL THEN
    RAISE EXCEPTION 'not_member_of_recipient_organization';
  END IF;

  RETURN QUERY
  SELECT
    gl.id                                            AS link_id,
    gl.agency_id                                     AS sender_agency_id,
    COALESCE(a.name, '')                             AS sender_agency_name,
    COALESCE(array_length(gl.model_ids, 1), 0)       AS model_count,
    gl.label                                         AS label,
    gl.type                                          AS type,
    gl.expires_at                                    AS expires_at,
    gl.is_active                                     AS is_active,
    gl.created_at                                    AS created_at,
    gl.first_accessed_at                             AS first_accessed_at
  FROM public.guest_links gl
  LEFT JOIN public.agencies a ON a.id = gl.agency_id
  WHERE gl.purpose = 'agency_share'
    AND gl.target_agency_id = v_recipient_agency
    AND gl.deleted_at IS NULL
  ORDER BY gl.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_agency_share_inbox(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_agency_share_inbox(uuid) TO authenticated;

COMMENT ON FUNCTION public.get_agency_share_inbox(uuid) IS
  'Agency-to-Agency Roster Share recipient inbox (20261026). Lists guest_links rows '
  'with purpose=agency_share targeted at the caller agency (via organization_members).';

-- -----------------------------------------------------------------------------
-- 2) get_agency_share_models
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_agency_share_models(uuid);

CREATE OR REPLACE FUNCTION public.get_agency_share_models(
  p_link_id uuid
)
RETURNS TABLE(
  id                  uuid,
  name                text,
  height              integer,
  bust                integer,
  waist               integer,
  hips                integer,
  city                text,
  hair_color          text,
  eye_color           text,
  sex                 text,
  portfolio_images    text[],
  polaroids           text[],
  effective_city      text,
  user_id             uuid,
  has_account         boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_caller            uuid;
  v_target_agency     uuid;
  v_model_ids         uuid[];
  v_type              text;
  v_sender_agency_id  uuid;
BEGIN
  v_caller := auth.uid();
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF p_link_id IS NULL THEN
    RAISE EXCEPTION 'link_id_required';
  END IF;

  SELECT
    gl.target_agency_id,
    gl.model_ids,
    gl.type,
    gl.agency_id
  INTO v_target_agency, v_model_ids, v_type, v_sender_agency_id
  FROM public.guest_links gl
  WHERE gl.id = p_link_id
    AND gl.purpose = 'agency_share'
    AND gl.is_active = true
    AND gl.deleted_at IS NULL
    AND (gl.expires_at IS NULL OR gl.expires_at > now());

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_target_agency IS NULL THEN
    RAISE EXCEPTION 'share_has_no_target_agency';
  END IF;

  -- Caller must be member of an agency org whose agency_id matches target_agency
  IF NOT EXISTS (
    SELECT 1
    FROM public.organization_members om
    JOIN public.organizations o ON o.id = om.organization_id
    WHERE om.user_id = v_caller
      AND o.type = 'agency'
      AND o.agency_id = v_target_agency
  ) THEN
    RAISE EXCEPTION 'not_member_of_target_agency';
  END IF;

  RETURN QUERY
  SELECT
    m.id,
    m.name,
    m.height,
    m.bust,
    m.waist,
    m.hips,
    m.city,
    m.hair_color,
    m.eye_color,
    m.sex::text,
    -- Portfolio: returned for 'portfolio' AND 'mixed'
    CASE
      WHEN v_type NOT IN ('portfolio', 'mixed') THEN '{}'::text[]
      WHEN m.portfolio_images IS NOT NULL
        AND cardinality(m.portfolio_images) > 0
        AND COALESCE(btrim(m.portfolio_images[1]), '') <> ''
      THEN m.portfolio_images
      ELSE COALESCE(
        (
          SELECT array_agg(mp.url ORDER BY mp.sort_order ASC NULLS LAST, mp.created_at ASC)
          FROM public.model_photos mp
          WHERE mp.model_id = m.id
            AND mp.photo_type = 'portfolio'
            AND mp.is_visible_to_clients = true
            AND COALESCE(mp.visible, true) = true
        ),
        ARRAY[]::text[]
      )
    END AS portfolio_images,
    -- Polaroid: returned for 'polaroid' AND 'mixed'
    CASE
      WHEN v_type NOT IN ('polaroid', 'mixed') THEN '{}'::text[]
      WHEN m.polaroids IS NOT NULL
        AND cardinality(m.polaroids) > 0
        AND COALESCE(btrim(m.polaroids[1]), '') <> ''
      THEN m.polaroids
      ELSE COALESCE(
        (
          SELECT array_agg(mp.url ORDER BY mp.sort_order ASC NULLS LAST, mp.created_at ASC)
          FROM public.model_photos mp
          WHERE mp.model_id = m.id
            AND mp.photo_type = 'polaroid'
            AND mp.is_visible_to_clients = true
            AND COALESCE(mp.visible, true) = true
        ),
        ARRAY[]::text[]
      )
    END AS polaroids,
    (
      SELECT ml.city
      FROM public.model_locations ml
      WHERE ml.model_id = m.id
        AND ml.city IS NOT NULL
        AND TRIM(ml.city) <> ''
      ORDER BY CASE ml.source
        WHEN 'live'    THEN 0
        WHEN 'current' THEN 1
        WHEN 'agency'  THEN 2
        ELSE 3
      END ASC
      LIMIT 1
    ) AS effective_city,
    m.user_id                       AS user_id,
    (m.user_id IS NOT NULL)         AS has_account
  FROM public.models m
  WHERE m.id = ANY(v_model_ids)
    AND m.agency_id = v_sender_agency_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_agency_share_models(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_agency_share_models(uuid) TO authenticated;

COMMENT ON FUNCTION public.get_agency_share_models(uuid) IS
  'Agency-to-Agency Roster Share recipient model loader (20261026). Same shape as '
  'get_guest_link_models plus user_id/has_account; no rate limit, no first_accessed_at '
  'consumption. Auth: caller must be member of the target_agency.';
