-- =============================================================================
-- AI Assistant persistent usage logging and org-configurable rate limits
--
-- Security boundary:
--   - No service_role path; Edge Function calls these RPCs with the user's JWT.
--   - Tables are not directly readable/writable by frontend clients.
--   - SECURITY DEFINER RPCs validate auth.uid(), role/org membership, and
--     optional organization_id against the authenticated caller.
--   - Stores usage metadata only: no prompts, answers, facts, model names,
--     calendar details, emails, phone numbers, secrets, access tokens, SQL, or
--     returned internal IDs.
--   - Retention recommendation: keep metadata 30-90 days via scheduled cleanup.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.ai_assistant_usage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NULL,
  user_id uuid NOT NULL,
  organization_id uuid NULL REFERENCES public.organizations(id) ON DELETE SET NULL,
  viewer_role text NOT NULL,
  intent text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  estimated_input_chars integer NOT NULL DEFAULT 0,
  estimated_output_chars integer NULL,
  result text NOT NULL,
  provider text NULL,
  model text NULL,
  duration_ms integer NULL,
  error_category text NULL,
  CONSTRAINT ai_assistant_usage_events_result_check CHECK (
    result IN ('allowed', 'blocked_rate_limit', 'blocked_invalid', 'blocked_forbidden', 'error')
  ),
  CONSTRAINT ai_assistant_usage_events_role_check CHECK (
    viewer_role IN ('agency', 'client', 'model')
  ),
  CONSTRAINT ai_assistant_usage_events_intent_check CHECK (
    intent IN (
      'help_static',
      'calendar_summary',
      'calendar_item_details',
      'model_visible_profile_facts',
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
  ),
  CONSTRAINT ai_assistant_usage_events_input_chars_check CHECK (estimated_input_chars >= 0),
  CONSTRAINT ai_assistant_usage_events_output_chars_check CHECK (
    estimated_output_chars IS NULL OR estimated_output_chars >= 0
  ),
  CONSTRAINT ai_assistant_usage_events_duration_check CHECK (
    duration_ms IS NULL OR duration_ms >= 0
  ),
  CONSTRAINT ai_assistant_usage_events_error_category_check CHECK (
    error_category IS NULL OR length(error_category) <= 80
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS ai_assistant_usage_events_request_id_uidx
  ON public.ai_assistant_usage_events (request_id)
  WHERE request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ai_assistant_usage_events_user_created_idx
  ON public.ai_assistant_usage_events (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ai_assistant_usage_events_org_created_idx
  ON public.ai_assistant_usage_events (organization_id, created_at DESC)
  WHERE organization_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ai_assistant_usage_events_intent_created_idx
  ON public.ai_assistant_usage_events (intent, created_at DESC);

ALTER TABLE public.ai_assistant_usage_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ai_assistant_usage_events FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.ai_assistant_usage_events IS
  'AI assistant rate-limit metadata only. Frontend has no direct access. Stores no prompt text, assistant answers, live facts, model names, calendar details, emails, phone numbers, secrets, access tokens, SQL, or returned internal IDs. Retain 30-90 days via scheduled cleanup.';
COMMENT ON COLUMN public.ai_assistant_usage_events.request_id IS
  'Server-generated opaque request identifier used only to update one usage reservation; never exposed to users.';
COMMENT ON COLUMN public.ai_assistant_usage_events.error_category IS
  'Sanitized low-cardinality category only, never raw provider/RPC/user content.';

CREATE TABLE IF NOT EXISTS public.ai_assistant_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL UNIQUE REFERENCES public.organizations(id) ON DELETE CASCADE,
  plan text NOT NULL DEFAULT 'default',
  user_hour_limit integer NOT NULL,
  user_day_limit integer NOT NULL,
  org_day_limit integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_assistant_limits_plan_nonempty CHECK (length(BTRIM(plan)) > 0),
  CONSTRAINT ai_assistant_limits_user_hour_positive CHECK (user_hour_limit > 0),
  CONSTRAINT ai_assistant_limits_user_day_positive CHECK (user_day_limit > 0),
  CONSTRAINT ai_assistant_limits_org_day_positive CHECK (org_day_limit > 0)
);

CREATE INDEX IF NOT EXISTS ai_assistant_limits_organization_idx
  ON public.ai_assistant_limits (organization_id);

ALTER TABLE public.ai_assistant_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ai_assistant_limits FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.ai_assistant_limits IS
  'Server-side AI assistant limit overrides per organization. No frontend access. Future plans can map starter/pro/enterprise/custom rows without billing logic here.';

CREATE OR REPLACE FUNCTION public.ai_assistant_limits_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ai_assistant_limits_touch_updated_at_trigger
  ON public.ai_assistant_limits;

CREATE TRIGGER ai_assistant_limits_touch_updated_at_trigger
BEFORE UPDATE ON public.ai_assistant_limits
FOR EACH ROW
EXECUTE FUNCTION public.ai_assistant_limits_touch_updated_at();

REVOKE ALL ON FUNCTION public.ai_assistant_limits_touch_updated_at() FROM PUBLIC, anon, authenticated;

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

COMMENT ON FUNCTION public.ai_assistant_check_rate_limit(uuid, text, text, uuid, integer) IS
  'AI assistant fail-closed rate-limit check. Authenticated only. Validates auth.uid(), viewer role, org membership, and optional org id. Atomically records allowed reservations or blocked_rate_limit metadata. Returns only allow/deny and coarse remaining counters; never returns rows, prompts, answers, facts, IDs, secrets, or content.';

COMMENT ON FUNCTION public.ai_assistant_record_usage(uuid, text, text, uuid, text, integer, integer, text, text, integer, text) IS
  'AI assistant usage finalizer. Authenticated only. Validates auth.uid(), viewer role, org membership, and request ownership. Stores minimized metadata only: result, char counts, provider/model labels, duration, sanitized error category. Never stores prompt text, assistant answers, live facts, messages, prices, emails, phones, secrets, SQL, or file URLs.';
