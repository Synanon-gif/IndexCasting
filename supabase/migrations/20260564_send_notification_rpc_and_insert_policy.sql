-- =============================================================================
-- N-4 Fix: Canonical migration for send_notification RPC and the hardened
-- notifications INSERT policy. Previously only in root-level
-- migration_notifications_rpc_hardening.sql (deploy-drift risk).
-- =============================================================================

-- ─── 1. Tighten INSERT policy ─────────────────────────────────────────────────
DROP POLICY IF EXISTS "notifications_insert_scoped"       ON public.notifications;
DROP POLICY IF EXISTS "notifications_insert_authenticated" ON public.notifications;
DROP POLICY IF EXISTS "notifications_insert_self_or_org"  ON public.notifications;

CREATE POLICY "notifications_insert_self_or_org"
  ON public.notifications
  FOR INSERT
  WITH CHECK (
    (
      user_id        = auth.uid()
      AND organization_id IS NULL
    )
    OR (
      organization_id IS NOT NULL
      AND user_id IS NULL
      AND EXISTS (
        SELECT 1 FROM public.organization_members om
        WHERE om.organization_id = notifications.organization_id
          AND om.user_id         = auth.uid()
      )
    )
  );

-- ─── 2. SECURITY DEFINER RPC: send_notification ───────────────────────────────
CREATE OR REPLACE FUNCTION public.send_notification(
  p_target_user_id  UUID,
  p_type            TEXT,
  p_title           TEXT,
  p_message         TEXT,
  p_metadata        JSONB DEFAULT '{}'::JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_caller_uid  UUID := auth.uid();
  v_authorized  BOOLEAN := false;
BEGIN
  IF v_caller_uid IS NULL THEN
    RAISE EXCEPTION 'send_notification: unauthenticated';
  END IF;

  IF p_target_user_id = v_caller_uid THEN
    RAISE EXCEPTION 'send_notification: use direct INSERT for self-notifications';
  END IF;

  -- Relationship 1: Shared option_request
  IF NOT v_authorized THEN
    SELECT TRUE INTO v_authorized
    FROM   public.option_requests orq
    WHERE  orq.status  != 'rejected'
      AND  (
        (orq.client_id = v_caller_uid  AND EXISTS (
            SELECT 1 FROM public.models m
            JOIN public.bookers bk ON bk.agency_id = m.agency_id
            WHERE m.id = orq.model_id AND bk.user_id = p_target_user_id
        ))
        OR (orq.client_id = p_target_user_id AND EXISTS (
            SELECT 1 FROM public.models m
            JOIN public.bookers bk ON bk.agency_id = m.agency_id
            WHERE m.id = orq.model_id AND bk.user_id = v_caller_uid
        ))
        OR EXISTS (
          SELECT 1 FROM public.organization_members om_s
          JOIN public.organization_members om_t
            ON  om_t.organization_id != om_s.organization_id
          WHERE om_s.user_id          = v_caller_uid
            AND om_t.user_id          = p_target_user_id
            AND (om_s.organization_id = orq.organization_id
                 OR om_t.organization_id = orq.organization_id)
        )
      )
    LIMIT 1;
  END IF;

  -- Relationship 2: Shared recruiting_chat_thread
  IF NOT v_authorized THEN
    SELECT TRUE INTO v_authorized
    FROM   public.recruiting_chat_threads rt
    JOIN   public.model_applications app ON app.id = rt.application_id
    WHERE  (
      (app.applicant_user_id = v_caller_uid AND EXISTS (
          SELECT 1 FROM public.organizations o
          JOIN   public.organization_members om ON om.organization_id = o.id
          WHERE  o.agency_id = rt.agency_id AND om.user_id = p_target_user_id
      ))
      OR (app.applicant_user_id = p_target_user_id AND EXISTS (
          SELECT 1 FROM public.organizations o
          JOIN   public.organization_members om ON om.organization_id = o.id
          WHERE  o.agency_id = rt.agency_id AND om.user_id = v_caller_uid
      ))
    )
    LIMIT 1;
  END IF;

  -- Relationship 3: Active B2B connection
  IF NOT v_authorized THEN
    SELECT TRUE INTO v_authorized
    FROM   public.client_agency_connections cac
    WHERE  cac.status != 'rejected'
      AND  (
        (
          cac.from_organization_id IS NOT NULL
          AND cac.to_organization_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM public.organization_members om
            WHERE om.organization_id = cac.from_organization_id
              AND om.user_id         = v_caller_uid
          )
          AND EXISTS (
            SELECT 1 FROM public.organization_members om
            WHERE om.organization_id = cac.to_organization_id
              AND om.user_id         = p_target_user_id
          )
        )
        OR (
          cac.from_organization_id IS NOT NULL
          AND cac.to_organization_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM public.organization_members om
            WHERE om.organization_id = cac.to_organization_id
              AND om.user_id         = v_caller_uid
          )
          AND EXISTS (
            SELECT 1 FROM public.organization_members om
            WHERE om.organization_id = cac.from_organization_id
              AND om.user_id         = p_target_user_id
          )
        )
        OR (
          cac.client_id = v_caller_uid
          AND EXISTS (
            SELECT 1 FROM public.organizations o
            JOIN   public.organization_members om ON om.organization_id = o.id
            WHERE  o.agency_id = cac.agency_id
              AND  om.user_id  = p_target_user_id
          )
        )
        OR (
          cac.client_id = p_target_user_id
          AND EXISTS (
            SELECT 1 FROM public.organizations o
            JOIN   public.organization_members om ON om.organization_id = o.id
            WHERE  o.agency_id = cac.agency_id
              AND  om.user_id  = v_caller_uid
          )
        )
      )
    LIMIT 1;
  END IF;

  -- Relationship 4: Linked model on booking_event
  IF NOT v_authorized THEN
    SELECT TRUE INTO v_authorized
    FROM   public.booking_events be
    WHERE  be.status != 'cancelled'
      AND  (
        (be.model_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.models m WHERE m.id = be.model_id AND m.user_id = v_caller_uid
        ) AND EXISTS (
          SELECT 1 FROM public.organization_members om
          WHERE om.user_id = p_target_user_id
            AND om.organization_id IN (be.agency_org_id, be.client_org_id)
        ))
        OR (be.model_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.models m WHERE m.id = be.model_id AND m.user_id = p_target_user_id
        ) AND EXISTS (
          SELECT 1 FROM public.organization_members om
          WHERE om.user_id = v_caller_uid
            AND om.organization_id IN (be.agency_org_id, be.client_org_id)
        ))
      )
    LIMIT 1;
  END IF;

  IF NOT v_authorized THEN
    RAISE EXCEPTION 'send_notification: no active relationship between sender and target user';
  END IF;

  INSERT INTO public.notifications (user_id, organization_id, type, title, message, metadata)
  VALUES (p_target_user_id, NULL, p_type, p_title, p_message, p_metadata);

  RETURN jsonb_build_object('ok', true);

EXCEPTION WHEN others THEN
  RAISE;
END;
$$;

REVOKE ALL ON FUNCTION public.send_notification(UUID, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.send_notification(UUID, TEXT, TEXT, TEXT, JSONB) TO authenticated;

COMMENT ON FUNCTION public.send_notification(UUID, TEXT, TEXT, TEXT, JSONB) IS
  'SECURITY DEFINER RPC for cross-party notifications. '
  'Validates active relationship (option_request, recruiting_thread, B2B connection, or booking_event) '
  'before inserting. Use direct INSERT for self-targeting or org-wide notifications.';
