-- =============================================================================
-- AI Assistant: ai_read_model_calendar_conflicts
--
-- Purpose:
--   Narrow read-only contract for intent model_calendar_availability_check.
--   Returns visible agency-scoped calendar rows for one actively represented
--   model on a single local calendar day.
--
-- Security boundaries:
--   - No service_role; invoked with the caller JWT via PostgREST.
--   - SECURITY DEFINER with row_security=off; validates auth.uid(), exactly one
--     Agency org membership (owner/booker), and model scope via
--     model_agency_territories (same gates as ai_read_model_visible_profile_facts).
--   - Agency-only: raises unsupported_role for non-agency callers.
--   - Model matching uses the same folded ranking as profile facts; multiple
--     best-rank hits return ambiguity metadata only (no cross-model data).
--   - Single day only (p_end_date implicit); rejects NULL date.
--   - Max 20 events; no IDs, emails, prices, messages, file URLs, raw enums.
--   - Excludes rejected option_requests and cancelled booking_events; calendar
--     entry times use latest non-cancelled calendar_entries row when present.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.ai_read_model_calendar_conflicts(
  p_search_text text,
  p_date date,
  p_limit integer DEFAULT 20
)
RETURNS jsonb
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
  v_similarity_threshold numeric := 0.40;
  v_match_limit integer := 5;
  v_event_limit integer;
  v_best_rank integer;
  v_match_count integer;
  v_model_id uuid;
  v_model_name text;
  v_events jsonb := '[]'::jsonb;
  v_candidates jsonb;
  r_option record;
  r_booking record;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF p_date IS NULL THEN
    RAISE EXCEPTION 'invalid_date';
  END IF;

  v_search_text := NULLIF(BTRIM(COALESCE(p_search_text, '')), '');
  IF v_search_text IS NULL OR length(v_search_text) < 2 OR length(v_search_text) > 80 THEN
    RAISE EXCEPTION 'invalid_search';
  END IF;

  v_event_limit := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 20);

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

  WITH visible_models AS (
    SELECT DISTINCT ON (m.id)
      m.id AS scoped_model_id,
      NULLIF(BTRIM(m.name), '') AS scoped_display_name,
      public.ai_assistant_fold_search_text(NULLIF(BTRIM(m.name), '')) AS scoped_display_name_folded,
      regexp_split_to_array(public.ai_assistant_fold_search_text(NULLIF(BTRIM(m.name), '')), '\s+') AS scoped_name_tokens
    FROM public.model_agency_territories mat
    JOIN public.models m ON m.id = mat.model_id
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
      vm.scoped_model_id,
      vm.scoped_display_name,
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
        WHEN length(v_search_folded) >= 3
          AND similarity(vm.scoped_display_name_folded, v_search_folded) >= v_similarity_threshold THEN 4
        ELSE 99
      END AS match_rank,
      similarity(vm.scoped_display_name_folded, v_search_folded) AS match_similarity
    FROM visible_models vm
  ),
  best_rank AS (
    SELECT MIN(match_rank) AS rank
    FROM ranked_matches
    WHERE match_rank < 99
  ),
  chosen AS (
    SELECT rm.scoped_model_id, rm.scoped_display_name, rm.match_similarity
    FROM ranked_matches rm
    JOIN best_rank br ON br.rank = rm.match_rank
    ORDER BY rm.match_similarity DESC, rm.scoped_display_name ASC
    LIMIT v_match_limit
  )
  SELECT
    (SELECT rank FROM best_rank),
    (SELECT COUNT(*)::integer FROM chosen),
    (SELECT scoped_model_id FROM chosen LIMIT 1),
    (SELECT scoped_display_name FROM chosen LIMIT 1)
  INTO v_best_rank, v_match_count, v_model_id, v_model_name;

  IF v_best_rank IS NULL OR v_match_count = 0 THEN
    RETURN jsonb_build_object(
      'match_status', 'none'
    );
  END IF;

  IF v_match_count > 1 THEN
    WITH visible_models AS (
      SELECT DISTINCT ON (m.id)
        m.id AS scoped_model_id,
        NULLIF(BTRIM(m.name), '') AS scoped_display_name,
        public.ai_assistant_fold_search_text(NULLIF(BTRIM(m.name), '')) AS scoped_display_name_folded,
        regexp_split_to_array(public.ai_assistant_fold_search_text(NULLIF(BTRIM(m.name), '')), '\s+') AS scoped_name_tokens
      FROM public.model_agency_territories mat
      JOIN public.models m ON m.id = mat.model_id
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
        vm.scoped_model_id,
        vm.scoped_display_name,
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
          WHEN length(v_search_folded) >= 3
            AND similarity(vm.scoped_display_name_folded, v_search_folded) >= v_similarity_threshold THEN 4
          ELSE 99
        END AS match_rank,
        similarity(vm.scoped_display_name_folded, v_search_folded) AS match_similarity
      FROM visible_models vm
    ),
    best_rank AS (
      SELECT MIN(match_rank) AS rank
      FROM ranked_matches
      WHERE match_rank < 99
    ),
    chosen AS (
      SELECT rm.scoped_display_name
      FROM ranked_matches rm
      JOIN best_rank br ON br.rank = rm.match_rank
      ORDER BY rm.match_similarity DESC, rm.scoped_display_name ASC
      LIMIT v_match_limit
    )
    SELECT COALESCE(
      (
        SELECT jsonb_agg(to_jsonb(display_name) ORDER BY display_name)
        FROM (SELECT DISTINCT scoped_display_name AS display_name FROM chosen) d
      ),
      '[]'::jsonb
    )
    INTO v_candidates;

    RETURN jsonb_build_object(
      'match_status', 'ambiguous',
      'candidates', v_candidates
    );
  END IF;

  FOR r_option IN
    SELECT
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
      NULLIF(BTRIM(COALESCE(oq.client_organization_name, oq.client_name)), '') AS visible_counterparty_name,
      NULL::text AS visible_note
    FROM public.option_requests oq
    LEFT JOIN LATERAL (
      SELECT ce2.start_time, ce2.end_time
      FROM public.calendar_entries ce2
      WHERE ce2.option_request_id = oq.id
        AND COALESCE(ce2.status::text, '') <> 'cancelled'
      ORDER BY ce2.created_at DESC
      LIMIT 1
    ) ce ON true
    WHERE oq.requested_date = p_date
      AND oq.status::text <> 'rejected'
      AND oq.model_id = v_model_id
      AND (
        oq.agency_organization_id = v_org_id
        OR (v_agency_id IS NOT NULL AND oq.agency_id = v_agency_id)
      )
    ORDER BY oq.created_at ASC
    LIMIT v_event_limit
  LOOP
    v_events := v_events || jsonb_build_array(
      jsonb_build_object(
        'kind', r_option.event_kind,
        'title', r_option.event_title,
        'start_time', r_option.event_start_time,
        'end_time', r_option.event_end_time,
        'counterparty_name', r_option.visible_counterparty_name,
        'note', r_option.visible_note
      )
    );
  END LOOP;

  IF jsonb_array_length(v_events) < v_event_limit THEN
    FOR r_booking IN
      SELECT
        NULL::text AS event_start_time,
        NULL::text AS event_end_time,
        'booking'::text AS event_kind,
        COALESCE(NULLIF(BTRIM(be.title), ''), 'Booking') AS event_title,
        NULLIF(BTRIM(client_org.name), '') AS visible_counterparty_name,
        NULL::text AS visible_note
      FROM public.booking_events be
      LEFT JOIN public.organizations client_org ON client_org.id = be.client_org_id
      WHERE be.date = p_date
        AND be.status <> 'cancelled'
        AND be.source_option_request_id IS NULL
        AND be.model_id = v_model_id
        AND be.agency_org_id = v_org_id
      ORDER BY be.created_at ASC
      LIMIT (v_event_limit - jsonb_array_length(v_events))
    LOOP
      v_events := v_events || jsonb_build_array(
        jsonb_build_object(
          'kind', r_booking.event_kind,
          'title', r_booking.event_title,
          'start_time', r_booking.event_start_time,
          'end_time', r_booking.event_end_time,
          'counterparty_name', r_booking.visible_counterparty_name,
          'note', r_booking.visible_note
        )
      );
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'match_status', 'found',
    'model_display_name', v_model_name,
    'check_date', p_date::text,
    'has_visible_conflicts', jsonb_array_length(v_events) > 0,
    'events', v_events
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ai_read_model_calendar_conflicts(text, date, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ai_read_model_calendar_conflicts(text, date, integer) TO authenticated;

COMMENT ON FUNCTION public.ai_read_model_calendar_conflicts(text, date, integer) IS
  'AI assistant agency-only: visible calendar conflicts for one MAT-scoped model on one date. SECURITY DEFINER with internal org+model guards. Returns JSON with match_status none|ambiguous|found; never exposes IDs, emails, prices, or writes.';

-- -----------------------------------------------------------------------------
-- Rate limit + usage: allow new intent model_calendar_availability_check
-- -----------------------------------------------------------------------------

ALTER TABLE public.ai_assistant_usage_events DROP CONSTRAINT IF EXISTS ai_assistant_usage_events_intent_check;

ALTER TABLE public.ai_assistant_usage_events ADD CONSTRAINT ai_assistant_usage_events_intent_check CHECK (
  intent IN (
    'help_static',
    'calendar_summary',
    'calendar_item_details',
    'model_visible_profile_facts',
    'model_calendar_availability_check',
    'billing',
    'team_management',
    'admin_security',
    'database_schema',
    'raw_messages',
    'cross_org',
    'write_action',
    'model_hidden_data',
    'gdpr_export_delete',
    'unknown_live_data',
    'invalid'
  )
);

CREATE OR REPLACE FUNCTION public.ai_assistant_check_rate_limit(
  p_request_id uuid,
  p_viewer_role text,
  p_intent text,
  p_organization_id uuid DEFAULT NULL,
  p_estimated_input_chars integer DEFAULT 0
)
RETURNS TABLE(
  allowed boolean,
  reason text,
  retry_after_seconds integer,
  remaining_user_hour integer,
  remaining_user_day integer,
  remaining_org_day integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_org_id uuid;
  v_org_count integer;
  v_user_hour_limit integer := 20;
  v_user_day_limit integer := 80;
  v_org_day_limit integer := 200;
  v_user_hour_count integer;
  v_user_day_count integer;
  v_org_day_count integer := 0;
  v_now timestamptz := now();
  v_retry_after integer := 3600;
  v_reason text := NULL;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'invalid_request';
  END IF;

  IF p_viewer_role NOT IN ('agency', 'client', 'model') THEN
    RAISE EXCEPTION 'unsupported_role';
  END IF;

  IF p_intent NOT IN (
    'help_static',
    'calendar_summary',
    'calendar_item_details',
    'model_visible_profile_facts',
    'model_calendar_availability_check',
    'billing',
    'team_management',
    'admin_security',
    'database_schema',
    'raw_messages',
    'cross_org',
    'write_action',
    'model_hidden_data',
    'gdpr_export_delete',
    'unknown_live_data',
    'invalid'
  ) THEN
    RAISE EXCEPTION 'unsupported_intent';
  END IF;

  IF COALESCE(p_estimated_input_chars, 0) < 0 OR COALESCE(p_estimated_input_chars, 0) > 2000 THEN
    RAISE EXCEPTION 'invalid_input_size';
  END IF;

  IF p_viewer_role IN ('agency', 'client') THEN
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

    SELECT o.id
    INTO v_org_id
    FROM public.organization_members om
    JOIN public.organizations o ON o.id = om.organization_id
    WHERE om.user_id = v_uid
      AND o.type::text = p_viewer_role
      AND (
        (p_viewer_role = 'agency' AND om.role IN ('owner'::org_member_role, 'booker'::org_member_role))
        OR
        (p_viewer_role = 'client' AND om.role IN ('owner'::org_member_role, 'employee'::org_member_role))
      );

    IF p_organization_id IS NOT NULL AND p_organization_id <> v_org_id THEN
      RAISE EXCEPTION 'org_context_mismatch';
    END IF;
  ELSE
    IF p_organization_id IS NOT NULL THEN
      RAISE EXCEPTION 'org_context_mismatch';
    END IF;
    v_org_id := NULL;
  END IF;

  BEGIN
    SELECT
      COALESCE(l.user_hour_limit, 20),
      COALESCE(l.user_day_limit, 80),
      COALESCE(l.org_day_limit, 200)
    INTO v_user_hour_limit, v_user_day_limit, v_org_day_limit
    FROM (SELECT v_org_id AS organization_id) ctx
    LEFT JOIN public.ai_assistant_limits l ON l.organization_id = ctx.organization_id;
  EXCEPTION WHEN OTHERS THEN
    v_user_hour_limit := 20;
    v_user_day_limit := 80;
    v_org_day_limit := 200;
  END;

  SELECT COUNT(*)::integer
  INTO v_user_hour_count
  FROM public.ai_assistant_usage_events e
  WHERE e.user_id = v_uid
    AND e.created_at >= v_now - interval '1 hour';

  SELECT COUNT(*)::integer
  INTO v_user_day_count
  FROM public.ai_assistant_usage_events e
  WHERE e.user_id = v_uid
    AND e.created_at >= v_now - interval '1 day';

  IF v_org_id IS NOT NULL THEN
    SELECT COUNT(*)::integer
    INTO v_org_day_count
    FROM public.ai_assistant_usage_events e
    WHERE e.organization_id = v_org_id
      AND e.created_at >= v_now - interval '1 day';
  END IF;

  IF v_user_hour_count >= v_user_hour_limit THEN
    v_reason := 'user_hour';
    SELECT GREATEST(1, CEIL(EXTRACT(EPOCH FROM ((MIN(e.created_at) + interval '1 hour') - v_now)))::integer)
    INTO v_retry_after
    FROM public.ai_assistant_usage_events e
    WHERE e.user_id = v_uid
      AND e.created_at >= v_now - interval '1 hour';
  ELSIF v_user_day_count >= v_user_day_limit THEN
    v_reason := 'user_day';
    SELECT GREATEST(1, CEIL(EXTRACT(EPOCH FROM ((MIN(e.created_at) + interval '1 day') - v_now)))::integer)
    INTO v_retry_after
    FROM public.ai_assistant_usage_events e
    WHERE e.user_id = v_uid
      AND e.created_at >= v_now - interval '1 day';
  ELSIF v_org_id IS NOT NULL AND v_org_day_count >= v_org_day_limit THEN
    v_reason := 'org_day';
    SELECT GREATEST(1, CEIL(EXTRACT(EPOCH FROM ((MIN(e.created_at) + interval '1 day') - v_now)))::integer)
    INTO v_retry_after
    FROM public.ai_assistant_usage_events e
    WHERE e.organization_id = v_org_id
      AND e.created_at >= v_now - interval '1 day';
  END IF;

  IF v_reason IS NOT NULL THEN
    INSERT INTO public.ai_assistant_usage_events (
      request_id,
      user_id,
      organization_id,
      viewer_role,
      intent,
      estimated_input_chars,
      result
    )
    VALUES (
      p_request_id,
      v_uid,
      v_org_id,
      p_viewer_role,
      p_intent,
      LEAST(GREATEST(COALESCE(p_estimated_input_chars, 0), 0), 2000),
      'blocked_rate_limit'
    )
    ON CONFLICT (request_id) WHERE request_id IS NOT NULL DO NOTHING;

    RETURN QUERY SELECT
      false,
      v_reason,
      COALESCE(v_retry_after, 3600),
      0,
      GREATEST(v_user_day_limit - v_user_day_count, 0),
      CASE WHEN v_org_id IS NULL THEN NULL ELSE GREATEST(v_org_day_limit - v_org_day_count, 0) END;
    RETURN;
  END IF;

  INSERT INTO public.ai_assistant_usage_events (
    request_id,
    user_id,
    organization_id,
    viewer_role,
    intent,
    estimated_input_chars,
    result
  )
  VALUES (
    p_request_id,
    v_uid,
    v_org_id,
    p_viewer_role,
    p_intent,
    LEAST(GREATEST(COALESCE(p_estimated_input_chars, 0), 0), 2000),
    'allowed'
  )
  ON CONFLICT (request_id) WHERE request_id IS NOT NULL DO NOTHING;

  RETURN QUERY SELECT
    true,
    'allowed'::text,
    NULL::integer,
    GREATEST(v_user_hour_limit - v_user_hour_count - 1, 0),
    GREATEST(v_user_day_limit - v_user_day_count - 1, 0),
    CASE WHEN v_org_id IS NULL THEN NULL ELSE GREATEST(v_org_day_limit - v_org_day_count - 1, 0) END;
END;
$$;

CREATE OR REPLACE FUNCTION public.ai_assistant_record_usage(
  p_request_id uuid,
  p_viewer_role text,
  p_intent text,
  p_organization_id uuid DEFAULT NULL,
  p_result text DEFAULT 'allowed',
  p_estimated_input_chars integer DEFAULT 0,
  p_estimated_output_chars integer DEFAULT NULL,
  p_provider text DEFAULT NULL,
  p_model text DEFAULT NULL,
  p_duration_ms integer DEFAULT NULL,
  p_error_category text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_org_id uuid;
  v_org_count integer;
  v_existing_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'invalid_request';
  END IF;

  IF p_viewer_role NOT IN ('agency', 'client', 'model') THEN
    RAISE EXCEPTION 'unsupported_role';
  END IF;

  IF p_result NOT IN ('allowed', 'blocked_rate_limit', 'blocked_invalid', 'blocked_forbidden', 'error') THEN
    RAISE EXCEPTION 'unsupported_result';
  END IF;

  IF p_intent NOT IN (
    'help_static',
    'calendar_summary',
    'calendar_item_details',
    'model_visible_profile_facts',
    'model_calendar_availability_check',
    'billing',
    'team_management',
    'admin_security',
    'database_schema',
    'raw_messages',
    'cross_org',
    'write_action',
    'model_hidden_data',
    'gdpr_export_delete',
    'unknown_live_data',
    'invalid'
  ) THEN
    RAISE EXCEPTION 'unsupported_intent';
  END IF;

  IF p_viewer_role IN ('agency', 'client') THEN
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

    SELECT o.id
    INTO v_org_id
    FROM public.organization_members om
    JOIN public.organizations o ON o.id = om.organization_id
    WHERE om.user_id = v_uid
      AND o.type::text = p_viewer_role
      AND (
        (p_viewer_role = 'agency' AND om.role IN ('owner'::org_member_role, 'booker'::org_member_role))
        OR
        (p_viewer_role = 'client' AND om.role IN ('owner'::org_member_role, 'employee'::org_member_role))
      );

    IF p_organization_id IS NOT NULL AND p_organization_id <> v_org_id THEN
      RAISE EXCEPTION 'org_context_mismatch';
    END IF;
  ELSE
    IF p_organization_id IS NOT NULL THEN
      RAISE EXCEPTION 'org_context_mismatch';
    END IF;
    v_org_id := NULL;
  END IF;

  SELECT e.id
  INTO v_existing_id
  FROM public.ai_assistant_usage_events e
  WHERE e.request_id = p_request_id
    AND e.user_id = v_uid
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    UPDATE public.ai_assistant_usage_events
    SET
      result = p_result,
      estimated_output_chars = CASE
        WHEN p_estimated_output_chars IS NULL THEN NULL
        ELSE LEAST(GREATEST(p_estimated_output_chars, 0), 20000)
      END,
      provider = NULLIF(BTRIM(LEFT(COALESCE(p_provider, ''), 40)), ''),
      model = NULLIF(BTRIM(LEFT(COALESCE(p_model, ''), 80)), ''),
      duration_ms = CASE
        WHEN p_duration_ms IS NULL THEN NULL
        ELSE LEAST(GREATEST(p_duration_ms, 0), 600000)
      END,
      error_category = NULLIF(BTRIM(LEFT(COALESCE(p_error_category, ''), 80)), '')
    WHERE id = v_existing_id;
    RETURN true;
  END IF;

  INSERT INTO public.ai_assistant_usage_events (
    request_id,
    user_id,
    organization_id,
    viewer_role,
    intent,
    estimated_input_chars,
    estimated_output_chars,
    result,
    provider,
    model,
    duration_ms,
    error_category
  )
  VALUES (
    p_request_id,
    v_uid,
    v_org_id,
    p_viewer_role,
    p_intent,
    LEAST(GREATEST(COALESCE(p_estimated_input_chars, 0), 0), 2000),
    CASE
      WHEN p_estimated_output_chars IS NULL THEN NULL
      ELSE LEAST(GREATEST(p_estimated_output_chars, 0), 20000)
    END,
    p_result,
    NULLIF(BTRIM(LEFT(COALESCE(p_provider, ''), 40)), ''),
    NULLIF(BTRIM(LEFT(COALESCE(p_model, ''), 80)), ''),
    CASE
      WHEN p_duration_ms IS NULL THEN NULL
      ELSE LEAST(GREATEST(p_duration_ms, 0), 600000)
    END,
    NULLIF(BTRIM(LEFT(COALESCE(p_error_category, ''), 80)), '')
  );
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.ai_assistant_check_rate_limit(uuid, text, text, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ai_assistant_check_rate_limit(uuid, text, text, uuid, integer) TO authenticated;

REVOKE ALL ON FUNCTION public.ai_assistant_record_usage(uuid, text, text, uuid, text, integer, integer, text, text, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ai_assistant_record_usage(uuid, text, text, uuid, text, integer, integer, text, text, integer, text) TO authenticated;
