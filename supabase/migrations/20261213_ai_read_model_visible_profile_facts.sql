-- =============================================================================
-- Phase 2 AI Assistant: ai_read_model_visible_profile_facts
--
-- Purpose:
--   Narrow read-only live-data contract for Agency-only visible model profile facts.
--
-- Security boundaries:
--   - No service_role path; called with the user's JWT through PostgREST.
--   - SECURITY DEFINER + row_security=off is used only to assemble a minimal
--     read model while explicitly validating auth.uid(), exactly one Agency org
--     membership, and model visibility through model_agency_territories.
--   - No free SQL, no arbitrary table/RPC access, no writes.
--   - Agency only. Client, Model, Guest, Admin/security, billing, messages, team,
--     invites, hidden/private model data, media URLs, and write actions are outside scope.
--   - Returns no IDs, emails, phone numbers, sync IDs, notes, file paths, or URLs.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.ai_read_model_visible_profile_facts(
  p_search_text text,
  p_limit integer DEFAULT 5
)
RETURNS TABLE(
  display_name text,
  city text,
  country text,
  height integer,
  chest integer,
  waist integer,
  hips integer,
  shoes numeric,
  hair text,
  eyes text,
  categories text[],
  account_linked boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_org_id uuid;
  v_agency_id uuid;
  v_org_count integer;
  v_search_text text;
  v_search_pattern text;
  v_limit integer;
BEGIN
  -- INTERNAL GUARD 1: authenticated caller only.
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  v_search_text := NULLIF(BTRIM(COALESCE(p_search_text, '')), '');
  IF v_search_text IS NULL OR length(v_search_text) < 2 OR length(v_search_text) > 80 THEN
    RAISE EXCEPTION 'invalid_search';
  END IF;

  v_limit := LEAST(GREATEST(COALESCE(p_limit, 5), 1), 5);
  v_search_pattern := '%' ||
    replace(
      replace(
        replace(v_search_text, chr(92), chr(92) || chr(92)),
        '%',
        chr(92) || '%'
      ),
      '_',
      chr(92) || '_'
    ) ||
    '%';

  -- INTERNAL GUARD 2: caller must have exactly one Agency organization context.
  -- No implicit LIMIT 1 org resolution: multi-agency users fail closed.
  SELECT COUNT(*)::integer
  INTO v_org_count
  FROM public.organization_members om
  JOIN public.organizations o ON o.id = om.organization_id
  WHERE om.user_id = v_uid
    AND o.type::text = 'agency'
    AND o.agency_id IS NOT NULL
    AND om.role::text IN ('owner', 'booker');

  IF v_org_count = 0 THEN
    RAISE EXCEPTION 'org_context_missing';
  END IF;
  IF v_org_count > 1 THEN
    RAISE EXCEPTION 'org_context_ambiguous';
  END IF;

  SELECT o.id, o.agency_id
  INTO v_org_id, v_agency_id
  FROM public.organization_members om
  JOIN public.organizations o ON o.id = om.organization_id
  WHERE om.user_id = v_uid
    AND o.type::text = 'agency'
    AND o.agency_id IS NOT NULL
    AND om.role::text IN ('owner', 'booker');

  IF v_org_id IS NULL OR v_agency_id IS NULL THEN
    RAISE EXCEPTION 'org_context_missing';
  END IF;

  -- INTERNAL GUARD 3: every model row below is scoped through the caller's
  -- verified agency_id and the Agency roster source of truth (MAT).
  RETURN QUERY
  WITH visible_models AS (
    SELECT DISTINCT ON (m.id)
      m.id AS scoped_model_id,
      NULLIF(BTRIM(m.name), '') AS scoped_display_name,
      CASE WHEN m.height > 0 THEN m.height ELSE NULL END AS scoped_height,
      CASE WHEN COALESCE(m.chest, m.bust) > 0 THEN COALESCE(m.chest, m.bust) ELSE NULL END AS scoped_chest,
      CASE WHEN m.waist > 0 THEN m.waist ELSE NULL END AS scoped_waist,
      CASE WHEN m.hips > 0 THEN m.hips ELSE NULL END AS scoped_hips,
      CASE WHEN m.shoe_size > 0 THEN m.shoe_size::numeric ELSE NULL END AS scoped_shoes,
      NULLIF(BTRIM(m.hair_color), '') AS scoped_hair,
      NULLIF(BTRIM(m.eye_color), '') AS scoped_eyes,
      CASE
        WHEN m.categories IS NULL OR array_length(m.categories, 1) IS NULL THEN ARRAY[]::text[]
        ELSE m.categories
      END AS scoped_categories,
      (m.user_id IS NOT NULL) AS scoped_account_linked,
      COALESCE(NULLIF(BTRIM(loc.city), ''), NULLIF(BTRIM(m.city), '')) AS scoped_city,
      COALESCE(NULLIF(BTRIM(loc.country_code), ''), NULLIF(BTRIM(m.country_code), ''), NULLIF(BTRIM(m.country), '')) AS scoped_country
    FROM public.model_agency_territories mat
    JOIN public.models m ON m.id = mat.model_id
    LEFT JOIN LATERAL (
      SELECT ml.city, ml.country_code
      FROM public.model_locations ml
      WHERE ml.model_id = m.id
        AND (
          NULLIF(BTRIM(ml.city), '') IS NOT NULL
          OR NULLIF(BTRIM(ml.country_code), '') IS NOT NULL
        )
      ORDER BY
        CASE ml.source
          WHEN 'live' THEN 1
          WHEN 'current' THEN 2
          WHEN 'agency' THEN 3
          ELSE 4
        END,
        ml.updated_at DESC NULLS LAST
      LIMIT 1
    ) loc ON true
    WHERE mat.agency_id = v_agency_id
      AND COALESCE(m.is_active, true) = true
      AND (
        m.agency_relationship_status IS NULL
        OR m.agency_relationship_status IN ('active', 'pending_link')
      )
      AND NULLIF(BTRIM(m.name), '') IS NOT NULL
  ),
  exact_matches AS (
    SELECT *
    FROM visible_models
    WHERE lower(scoped_display_name) = lower(v_search_text)
  ),
  fuzzy_matches AS (
    SELECT *
    FROM visible_models
    WHERE scoped_display_name ILIKE v_search_pattern ESCAPE '\'
  ),
  chosen_matches AS (
    SELECT * FROM exact_matches
    UNION ALL
    SELECT *
    FROM fuzzy_matches
    WHERE NOT EXISTS (SELECT 1 FROM exact_matches)
  )
  SELECT
    c.scoped_display_name AS display_name,
    c.scoped_city AS city,
    c.scoped_country AS country,
    c.scoped_height AS height,
    c.scoped_chest AS chest,
    c.scoped_waist AS waist,
    c.scoped_hips AS hips,
    c.scoped_shoes AS shoes,
    c.scoped_hair AS hair,
    c.scoped_eyes AS eyes,
    c.scoped_categories AS categories,
    c.scoped_account_linked AS account_linked
  FROM chosen_matches c
  ORDER BY
    CASE
      WHEN lower(c.scoped_display_name) = lower(v_search_text) THEN 0
      WHEN lower(c.scoped_display_name) LIKE lower(v_search_text) || '%' THEN 1
      ELSE 2
    END,
    c.scoped_display_name ASC
  LIMIT v_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.ai_read_model_visible_profile_facts(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ai_read_model_visible_profile_facts(text, integer) TO authenticated;

COMMENT ON FUNCTION public.ai_read_model_visible_profile_facts(text, integer) IS
  'Phase 2 AI assistant read-only Agency model visible profile facts. SECURITY DEFINER with row_security=off and internal guards: auth.uid(), exactly one Agency org membership, and model scope through model_agency_territories for caller agency. Max 5 rows. Returns only display name, visible location, measurements, hair/eyes/categories, and account_linked boolean; excludes IDs, email, phone, sync IDs, notes, files, URLs, billing, messages, team, admin/security data, and writes.';
