-- =============================================================================
-- Phase 2 AI Assistant: calendar_item_details + safer model name matching
--
-- Security boundaries:
--   - No service_role path; called with the user's JWT through PostgREST.
--   - SECURITY DEFINER + row_security=off functions validate auth.uid(), exactly
--     one matching Agency/Client org context, role, date bounds, and result limit.
--   - No writes, no free SQL, no broad reads, no IDs/emails/phones/files/messages,
--     no billing/payment/price/negotiation fields, no raw status enums.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.ai_assistant_fold_search_text(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
  SELECT lower(
    translate(
      COALESCE(p_value, ''),
      'áàâäãåāăąçćčďđéèêëēėęěíìîïīįłñńňóòôöõøōőŕřśšșťțúùûüūůűųýÿžźż',
      'aaaaaaaaacccddeeeeeeeeiiiiiilnnnoooooooorrsssttuuuuuuuuyyzzz'
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.ai_read_calendar_item_details(
  p_viewer_role text,
  p_mode text DEFAULT 'reference',
  p_reference jsonb DEFAULT NULL,
  p_start_date date DEFAULT NULL,
  p_end_date date DEFAULT NULL,
  p_limit integer DEFAULT 2
)
RETURNS TABLE(
  "date" date,
  start_time text,
  end_time text,
  kind text,
  title text,
  model_name text,
  counterparty_name text,
  status_label text,
  note text
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
  v_limit integer;
  v_start_date date;
  v_end_date date;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF p_viewer_role NOT IN ('agency', 'client') THEN
    RAISE EXCEPTION 'unsupported_role';
  END IF;

  IF p_mode NOT IN ('reference', 'last_job') THEN
    RAISE EXCEPTION 'unsupported_mode';
  END IF;

  v_limit := LEAST(GREATEST(COALESCE(p_limit, 2), 1), 2);

  IF p_mode = 'last_job' THEN
    IF p_start_date IS NULL OR p_end_date IS NULL OR p_end_date < p_start_date THEN
      RAISE EXCEPTION 'invalid_date_range';
    END IF;
    IF (p_end_date - p_start_date) > 89 THEN
      RAISE EXCEPTION 'date_range_too_large';
    END IF;
    v_start_date := p_start_date;
    v_end_date := p_end_date;
  ELSE
    IF p_reference IS NULL OR jsonb_typeof(p_reference) <> 'object' THEN
      RAISE EXCEPTION 'invalid_reference';
    END IF;
  END IF;

  SELECT COUNT(*)::integer
  INTO v_org_count
  FROM public.organization_members om
  JOIN public.organizations o ON o.id = om.organization_id
  WHERE om.user_id = v_uid
    AND o.type::text = p_viewer_role
    AND (
      (p_viewer_role = 'agency' AND om.role IN ('owner'::org_member_role, 'booker'::org_member_role))
      OR
      (p_viewer_role = 'client' AND om.role IN ('owner'::org_member_role, 'employee'::org_member_role))
    );

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
    AND o.type::text = p_viewer_role
    AND (
      (p_viewer_role = 'agency' AND om.role IN ('owner'::org_member_role, 'booker'::org_member_role))
      OR
      (p_viewer_role = 'client' AND om.role IN ('owner'::org_member_role, 'employee'::org_member_role))
    );

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'org_context_missing';
  END IF;

  RETURN QUERY
  WITH option_rows AS (
    SELECT
      oq.requested_date AS event_date,
      COALESCE(ce.start_time::text, oq.start_time::text) AS event_start_time,
      COALESCE(ce.end_time::text, oq.end_time::text) AS event_end_time,
      CASE
        WHEN oq.final_status::text = 'job_confirmed' THEN 'job'
        WHEN COALESCE(oq.request_type::text, 'option') = 'casting' THEN 'casting'
        ELSE 'option'
      END AS event_kind,
      CASE
        WHEN oq.final_status::text = 'job_confirmed' THEN 'Job'
        WHEN COALESCE(oq.request_type::text, 'option') = 'casting' THEN 'Casting'
        ELSE 'Option'
      END AS event_title,
      NULLIF(BTRIM(oq.model_name), '') AS visible_model_name,
      CASE
        WHEN p_viewer_role = 'agency'
          THEN NULLIF(BTRIM(COALESCE(oq.client_organization_name, oq.client_name)), '')
        ELSE NULLIF(BTRIM(oq.agency_organization_name), '')
      END AS visible_counterparty_name,
      CASE
        WHEN oq.final_status::text = 'job_confirmed' THEN 'Job confirmed'
        WHEN COALESCE(oq.request_type::text, 'option') = 'casting'
             AND oq.final_status::text = 'option_confirmed' THEN 'Casting confirmed'
        WHEN oq.final_status::text = 'option_confirmed' THEN 'Option confirmed'
        ELSE 'In progress'
      END AS visible_status_label,
      NULLIF(BTRIM(oq.job_description), '') AS visible_note
    FROM public.option_requests oq
    LEFT JOIN LATERAL (
      SELECT ce2.start_time, ce2.end_time
      FROM public.calendar_entries ce2
      WHERE ce2.option_request_id = oq.id
        AND COALESCE(ce2.status::text, '') <> 'cancelled'
      ORDER BY ce2.created_at DESC
      LIMIT 1
    ) ce ON true
    WHERE oq.status::text <> 'rejected'
      AND (
        (
          p_viewer_role = 'agency'
          AND (
            oq.agency_organization_id = v_org_id
            OR (v_agency_id IS NOT NULL AND oq.agency_id = v_agency_id)
          )
        )
        OR
        (
          p_viewer_role = 'client'
          AND (
            COALESCE(oq.client_organization_id, oq.organization_id) = v_org_id
            OR oq.client_id = v_uid
          )
        )
      )
  ),
  private_event_rows AS (
    SELECT
      uce.date AS event_date,
      uce.start_time::text AS event_start_time,
      uce.end_time::text AS event_end_time,
      'private_event'::text AS event_kind,
      uce.title AS event_title,
      NULL::text AS visible_model_name,
      NULL::text AS visible_counterparty_name,
      'Private event'::text AS visible_status_label,
      NULLIF(BTRIM(uce.note), '') AS visible_note
    FROM public.user_calendar_events uce
    WHERE uce.owner_type = p_viewer_role
      AND uce.organization_id = v_org_id
      AND uce.source_option_request_id IS NULL
      AND COALESCE(uce.status, 'active') <> 'cancelled'
  ),
  booking_rows AS (
    SELECT
      be.date AS event_date,
      NULL::text AS event_start_time,
      NULL::text AS event_end_time,
      'booking'::text AS event_kind,
      COALESCE(NULLIF(BTRIM(be.title), ''), 'Booking') AS event_title,
      NULLIF(BTRIM(m.name), '') AS visible_model_name,
      CASE
        WHEN p_viewer_role = 'agency' THEN NULLIF(BTRIM(client_org.name), '')
        ELSE NULLIF(BTRIM(agency_org.name), '')
      END AS visible_counterparty_name,
      CASE
        WHEN be.status = 'completed' THEN 'Completed booking'
        WHEN be.status = 'model_confirmed' THEN 'Confirmed booking'
        WHEN be.status = 'agency_accepted' THEN 'Agency accepted'
        ELSE 'Pending booking'
      END AS visible_status_label,
      NULLIF(BTRIM(be.note), '') AS visible_note
    FROM public.booking_events be
    LEFT JOIN public.models m ON m.id = be.model_id
    LEFT JOIN public.organizations client_org ON client_org.id = be.client_org_id
    LEFT JOIN public.organizations agency_org ON agency_org.id = be.agency_org_id
    WHERE be.status <> 'cancelled'
      AND be.source_option_request_id IS NULL
      AND (
        (p_viewer_role = 'agency' AND be.agency_org_id = v_org_id)
        OR
        (p_viewer_role = 'client' AND be.client_org_id = v_org_id)
      )
  ),
  rows AS (
    SELECT * FROM option_rows
    UNION ALL
    SELECT * FROM private_event_rows
    UNION ALL
    SELECT * FROM booking_rows
  ),
  filtered AS (
    SELECT *
    FROM rows
    WHERE (
      p_mode = 'last_job'
      AND rows.event_kind = 'job'
      AND rows.event_date BETWEEN v_start_date AND v_end_date
    )
    OR (
      p_mode = 'reference'
      AND rows.event_date::text = p_reference ->> 'date'
      AND rows.event_kind = p_reference ->> 'kind'
      AND rows.event_title = p_reference ->> 'title'
      AND COALESCE(rows.visible_model_name, '') = COALESCE(p_reference ->> 'model_name', '')
      AND COALESCE(rows.visible_counterparty_name, '') = COALESCE(p_reference ->> 'counterparty_name', '')
    )
  )
  SELECT
    filtered.event_date AS "date",
    filtered.event_start_time AS start_time,
    filtered.event_end_time AS end_time,
    filtered.event_kind AS kind,
    filtered.event_title AS title,
    filtered.visible_model_name AS model_name,
    filtered.visible_counterparty_name AS counterparty_name,
    filtered.visible_status_label AS status_label,
    filtered.visible_note AS note
  FROM filtered
  ORDER BY
    CASE WHEN p_mode = 'last_job' THEN filtered.event_date END DESC,
    CASE WHEN p_mode = 'last_job' THEN filtered.event_start_time END DESC NULLS LAST,
    CASE WHEN p_mode = 'reference' THEN filtered.event_date END ASC,
    filtered.event_title ASC
  LIMIT v_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.ai_read_calendar_item_details(text, text, jsonb, date, date, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ai_read_calendar_item_details(text, text, jsonb, date, date, integer) TO authenticated;

COMMENT ON FUNCTION public.ai_read_calendar_item_details(text, text, jsonb, date, date, integer) IS
  'Phase 2 AI assistant read-only calendar item details. Validates auth.uid(), exactly one matching Agency/Client org membership, max 90-day last-job lookback, and 1-2 row limit. Returns minimal product labels only; no IDs, emails, billing/pricing/negotiation, messages, file URLs, or writes.';

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
  v_search_folded text;
  v_search_pattern text;
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
    WHERE scoped_display_name_folded = v_search_folded
  ),
  prefix_matches AS (
    SELECT *
    FROM visible_models
    WHERE scoped_display_name_folded LIKE v_search_folded || '%'
  ),
  fuzzy_matches AS (
    SELECT *
    FROM visible_models
    WHERE scoped_display_name_folded LIKE v_search_pattern ESCAPE '\'
  ),
  chosen_matches AS (
    SELECT * FROM exact_matches
    UNION
    SELECT *
    FROM prefix_matches
    WHERE NOT EXISTS (SELECT 1 FROM exact_matches)
    UNION
    SELECT *
    FROM fuzzy_matches
    WHERE NOT EXISTS (SELECT 1 FROM exact_matches)
      AND NOT EXISTS (SELECT 1 FROM prefix_matches)
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
      WHEN c.scoped_display_name_folded = v_search_folded THEN 0
      WHEN c.scoped_display_name_folded LIKE v_search_folded || '%' THEN 1
      ELSE 2
    END,
    c.scoped_display_name ASC
  LIMIT v_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.ai_read_model_visible_profile_facts(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ai_read_model_visible_profile_facts(text, integer) TO authenticated;

COMMENT ON FUNCTION public.ai_read_model_visible_profile_facts(text, integer) IS
  'Phase 2 AI assistant read-only Agency model visible profile facts. SECURITY DEFINER with row_security=off and internal guards: auth.uid(), exactly one Agency org membership, and model scope through model_agency_territories for caller agency. Accent/case-insensitive exact, prefix, and partial display-name matching. Max 5 rows. Returns only display name, visible location, measurements, hair/eyes/categories, and account_linked boolean; excludes IDs, email, phone, sync IDs, notes, files, URLs, billing, messages, team, admin/security data, and writes.';
