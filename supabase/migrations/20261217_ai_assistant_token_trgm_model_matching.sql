-- =============================================================================
-- AI Assistant model matching: scoped token + trigram search
--
-- Security boundary:
--   - No new intent and no new returned fields.
--   - Matching is performed only after the caller's Agency org and MAT scope are
--     verified. This does not broaden model visibility.
--   - Returns the same minimized visible profile facts as before: no IDs, email,
--     phone, sync IDs, notes, media, file URLs, billing, messages, or writes.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.ai_assistant_fold_search_text(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
  SELECT BTRIM(
    regexp_replace(
      translate(
        lower(COALESCE(p_value, '')),
        'áàâäãåāăąçćčďđéèêëēėęěíìîïīįłñńňóòôöõøōőŕřśšșťțúùûüūůűųýÿžźż',
        'aaaaaaaaacccddeeeeeeeeiiiiiilnnnoooooooorrsssttuuuuuuuuyyzzz'
      ),
      '\s+',
      ' ',
      'g'
    )
  );
$$;

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
SET search_path = public, extensions
SET row_security TO off
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_org_id uuid;
  v_agency_id uuid;
  v_org_count integer;
  v_search_text text;
  v_search_folded text;
  v_search_pattern text;
  v_search_tokens text[];
  v_limit integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  v_search_text := NULLIF(BTRIM(COALESCE(p_search_text, '')), '');
  IF v_search_text IS NULL OR length(v_search_text) < 2 OR length(v_search_text) > 80 THEN
    RAISE EXCEPTION 'invalid_search';
  END IF;

  v_limit := LEAST(GREATEST(COALESCE(p_limit, 5), 1), 5);
  v_search_folded := public.ai_assistant_fold_search_text(v_search_text);
  v_search_tokens := regexp_split_to_array(v_search_folded, '\s+');
  v_search_pattern := '%' ||
    replace(
      replace(
        replace(v_search_folded, chr(92), chr(92) || chr(92)),
        '%',
        chr(92) || '%'
      ),
      '_',
      chr(92) || '_'
    ) ||
    '%';

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

  RETURN QUERY
  WITH visible_models AS (
    SELECT DISTINCT ON (m.id)
      m.id AS scoped_model_id,
      NULLIF(BTRIM(m.name), '') AS scoped_display_name,
      public.ai_assistant_fold_search_text(NULLIF(BTRIM(m.name), '')) AS scoped_display_name_folded,
      regexp_split_to_array(public.ai_assistant_fold_search_text(NULLIF(BTRIM(m.name), '')), '\s+') AS scoped_name_tokens,
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
  ranked_matches AS (
    SELECT
      vm.*,
      CASE
        WHEN vm.scoped_display_name_folded = v_search_folded THEN 0
        WHEN NOT EXISTS (
          SELECT 1
          FROM unnest(v_search_tokens) search_token
          WHERE NOT EXISTS (
            SELECT 1
            FROM unnest(vm.scoped_name_tokens) name_token
            WHERE name_token = search_token
          )
        ) THEN 1
        WHEN NOT EXISTS (
          SELECT 1
          FROM unnest(v_search_tokens) search_token
          WHERE NOT EXISTS (
            SELECT 1
            FROM unnest(vm.scoped_name_tokens) name_token
            WHERE name_token LIKE search_token || '%'
          )
        ) THEN 2
        WHEN vm.scoped_display_name_folded LIKE v_search_pattern ESCAPE '\' THEN 3
        WHEN similarity(vm.scoped_display_name_folded, v_search_folded) >= 0.35 THEN 4
        ELSE 99
      END AS match_rank,
      similarity(vm.scoped_display_name_folded, v_search_folded) AS match_similarity
    FROM visible_models vm
  ),
  chosen_matches AS (
    SELECT *
    FROM ranked_matches
    WHERE match_rank < 99
    ORDER BY match_rank, match_similarity DESC, scoped_display_name ASC
    LIMIT v_limit
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
  ORDER BY c.match_rank, c.match_similarity DESC, c.scoped_display_name ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.ai_read_model_visible_profile_facts(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ai_read_model_visible_profile_facts(text, integer) TO authenticated;

COMMENT ON FUNCTION public.ai_assistant_fold_search_text(text) IS
  'AI assistant safe text folding helper for visible model-name matching. Lowercases, folds accents, trims, and collapses whitespace. Does not read data or broaden model scope.';

COMMENT ON FUNCTION public.ai_read_model_visible_profile_facts(text, integer) IS
  'Phase 2 AI assistant read-only Agency model visible profile facts. SECURITY DEFINER with row_security=off and internal guards: auth.uid(), exactly one Agency org membership, and model scope through model_agency_territories for caller agency before matching. Uses folded exact, token, prefix, contains, and pg_trgm similarity matching. Max 5 rows. Returns only display name, visible location, measurements, hair/eyes/categories, and account_linked boolean; excludes IDs, email, phone, sync IDs, notes, files, URLs, billing, messages, team, admin/security data, and writes.';
