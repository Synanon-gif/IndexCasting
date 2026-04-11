-- =============================================================================
-- Org-scoped notifications for option/recruiting flows without requiring the
-- caller to be a member of the target organization (fixes 42501 when a client
-- or model targets the agency org row).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.notify_org_for_option_request(
  p_option_request_id       UUID,
  p_target_organization_id  UUID,
  p_type                    TEXT,
  p_title                   TEXT,
  p_message                 TEXT,
  p_metadata                JSONB DEFAULT '{}'::JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_uid       UUID := auth.uid();
  orq         RECORD;
  v_agency_org UUID;
  v_client_org UUID;
  v_ok        BOOLEAN := false;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT *
    INTO orq
  FROM public.option_requests
  WHERE id = p_option_request_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'option_request_not_found';
  END IF;

  v_agency_org := COALESCE(
    orq.agency_organization_id,
    (
      SELECT o.id
      FROM public.organizations o
      WHERE o.agency_id = orq.agency_id
        AND o.type = 'agency'
      LIMIT 1
    )
  );

  v_client_org := COALESCE(orq.client_organization_id, orq.organization_id);

  -- Client on the request → may target agency org only
  IF orq.client_id IS NOT NULL AND orq.client_id = v_uid THEN
    IF v_agency_org IS NOT NULL AND p_target_organization_id = v_agency_org THEN
      v_ok := true;
    END IF;
  END IF;

  -- Linked model → may target agency org only
  IF NOT v_ok AND EXISTS (
    SELECT 1 FROM public.models m
    WHERE m.id = orq.model_id AND m.user_id = v_uid
  ) THEN
    IF v_agency_org IS NOT NULL AND p_target_organization_id = v_agency_org THEN
      v_ok := true;
    END IF;
  END IF;

  -- Agency booker / org member → may target client org only
  IF NOT v_ok THEN
    IF EXISTS (
      SELECT 1 FROM public.organization_members om
      JOIN public.organizations o ON o.id = om.organization_id
      WHERE om.user_id = v_uid
        AND o.agency_id = orq.agency_id
        AND o.type = 'agency'
    ) OR EXISTS (
      SELECT 1 FROM public.bookers b
      WHERE b.agency_id = orq.agency_id AND b.user_id = v_uid
    ) THEN
      IF v_client_org IS NOT NULL AND p_target_organization_id = v_client_org THEN
        v_ok := true;
      END IF;
    END IF;
  END IF;

  IF NOT v_ok THEN
    RAISE EXCEPTION 'notify_org_for_option_request: not_authorized';
  END IF;

  INSERT INTO public.notifications (user_id, organization_id, type, title, message, metadata)
  VALUES (NULL, p_target_organization_id, p_type, p_title, p_message, COALESCE(p_metadata, '{}'::JSONB));

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.notify_org_for_option_request(UUID, UUID, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.notify_org_for_option_request(UUID, UUID, TEXT, TEXT, TEXT, JSONB) TO authenticated;

COMMENT ON FUNCTION public.notify_org_for_option_request IS
  'SECURITY DEFINER: insert org-scoped notification for option_request participants. '
  'Caller must be client_id, linked model user, or agency member for the request agency.';


CREATE OR REPLACE FUNCTION public.notify_org_for_recruiting_thread(
  p_thread_id               UUID,
  p_target_organization_id  UUID,
  p_type                    TEXT,
  p_title                   TEXT,
  p_message                 TEXT,
  p_metadata                JSONB DEFAULT '{}'::JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_uid UUID := auth.uid();
  rt    RECORD;
  v_ok  BOOLEAN := false;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT * INTO rt FROM public.recruiting_chat_threads WHERE id = p_thread_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'recruiting_thread_not_found';
  END IF;

  IF p_target_organization_id <> rt.organization_id THEN
    RAISE EXCEPTION 'notify_org_for_recruiting_thread: target_mismatch';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.model_applications app
    WHERE app.id = rt.application_id AND app.applicant_user_id = v_uid
  ) THEN
    v_ok := true;
  END IF;

  IF NOT v_ok AND EXISTS (
    SELECT 1 FROM public.organization_members om
    WHERE om.user_id = v_uid AND om.organization_id = rt.organization_id
  ) THEN
    v_ok := true;
  END IF;

  IF NOT v_ok THEN
    RAISE EXCEPTION 'notify_org_for_recruiting_thread: not_authorized';
  END IF;

  INSERT INTO public.notifications (user_id, organization_id, type, title, message, metadata)
  VALUES (NULL, p_target_organization_id, p_type, p_title, p_message, COALESCE(p_metadata, '{}'::JSONB));

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.notify_org_for_recruiting_thread(UUID, UUID, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.notify_org_for_recruiting_thread(UUID, UUID, TEXT, TEXT, TEXT, JSONB) TO authenticated;

COMMENT ON FUNCTION public.notify_org_for_recruiting_thread IS
  'SECURITY DEFINER: org notification for recruiting thread — applicant or agency org member.';
