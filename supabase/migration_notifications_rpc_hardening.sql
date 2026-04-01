-- =============================================================================
-- M-3: Notifications INSERT Hardening — SECURITY DEFINER RPC
--
-- Problem (from 2026-04 pre-launch audit):
--   The "notifications_insert_scoped" policy (Phase 26) still allows any
--   organization member to INSERT a notification targeting ANY arbitrary
--   user_id (cross-party clause #3). This permits notification spam /
--   phishing from any authenticated org member to any platform user.
--
-- Fix:
--   1. Replace the INSERT policy with a strict version that allows ONLY
--      self-targeting or org-wide notifications directly. Cross-party
--      notifications (Agency→Model, Client→Agency, etc.) MUST go through
--      the new SECURITY DEFINER RPC send_notification(), which validates
--      that an active relationship exists between sender and target.
--
--   2. Create send_notification() SECURITY DEFINER RPC that checks:
--        - Sender is an org member
--        - For cross-party user_id notifications: target user_id belongs to
--          an org that has a client_agency_connections entry with the sender's
--          org, OR shares an active option_request, OR is the model user in
--          a recruiting_thread of the sender's agency.
--
-- Run AFTER migration_fix_notifications_insert_rls.sql (Phase 26, #134)
--         AND migration_prelaunch_security_fixes.sql (Phase 29, above).
-- =============================================================================


-- ─── 1. Tighten INSERT policy ─────────────────────────────────────────────────
--
-- Allow direct INSERT only for self-targeted or org-targeted notifications.
-- Cross-party notifications must use send_notification() RPC.

DROP POLICY IF EXISTS "notifications_insert_scoped"       ON public.notifications;
DROP POLICY IF EXISTS "notifications_insert_authenticated" ON public.notifications;

CREATE POLICY "notifications_insert_self_or_org"
  ON public.notifications
  FOR INSERT
  WITH CHECK (
    -- 1. Self-targeted notification (user sends to themselves, e.g. local reminder)
    (
      user_id        = auth.uid()
      AND organization_id IS NULL
    )
    -- 2. Org-wide notification — caller must be a member of that org
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
--
-- Used for cross-party notifications (Agency→Model, Client→Agency, etc.).
-- Validates that a legitimate relationship exists between sender and target.
-- Returns { ok: true } on success or raises an exception on unauthorized access.

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
AS $$
DECLARE
  v_caller_uid  UUID := auth.uid();
  v_authorized  BOOLEAN := false;
BEGIN
  -- Must be authenticated
  IF v_caller_uid IS NULL THEN
    RAISE EXCEPTION 'send_notification: unauthenticated';
  END IF;

  -- Cannot notify yourself via cross-party RPC (use direct INSERT for self)
  IF p_target_user_id = v_caller_uid THEN
    RAISE EXCEPTION 'send_notification: use direct INSERT for self-notifications';
  END IF;

  -- Authorization check: at least one valid relationship must exist.
  --
  -- Relationship 1: Shared option_request (client ↔ agency negotiation/booking)
  IF NOT v_authorized THEN
    SELECT TRUE INTO v_authorized
    FROM   public.option_requests orq
    WHERE  orq.status  != 'rejected'
      AND  (
        -- Sender is on the client side, target is on the agency side (or vice-versa)
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
        -- Sender/target are org members of client or agency org
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

  -- Relationship 2: Shared recruiting_chat_thread (agency ↔ model applicant)
  IF NOT v_authorized THEN
    SELECT TRUE INTO v_authorized
    FROM   public.recruiting_chat_threads rt
    JOIN   public.model_applications app ON app.id = rt.application_id
    WHERE  (
      -- Caller is model applicant, target is agency member
      (app.applicant_user_id = v_caller_uid AND EXISTS (
          SELECT 1 FROM public.organizations o
          JOIN   public.organization_members om ON om.organization_id = o.id
          WHERE  o.agency_id = rt.agency_id AND om.user_id = p_target_user_id
      ))
      -- Caller is agency member, target is model applicant
      OR (app.applicant_user_id = p_target_user_id AND EXISTS (
          SELECT 1 FROM public.organizations o
          JOIN   public.organization_members om ON om.organization_id = o.id
          WHERE  o.agency_id = rt.agency_id AND om.user_id = v_caller_uid
      ))
    )
    LIMIT 1;
  END IF;

  -- Relationship 3: Active B2B connection (client org ↔ agency org).
  -- Uses from_organization_id / to_organization_id (added in
  -- migration_client_agency_connections_org_chat_rls.sql) as the primary
  -- check, with a fallback via the legacy client_id direct-user link for
  -- connections created before org columns existed.
  IF NOT v_authorized THEN
    SELECT TRUE INTO v_authorized
    FROM   public.client_agency_connections cac
    WHERE  cac.status != 'rejected'
      AND  (
        -- Org-level: caller's org → target's org (or reverse)
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
        -- Legacy fallback: direct client_id ↔ agency member check
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

  IF NOT v_authorized THEN
    RAISE EXCEPTION 'send_notification: no active relationship between sender and target user';
  END IF;

  -- Insert the notification
  INSERT INTO public.notifications (user_id, organization_id, type, title, message, metadata)
  VALUES (p_target_user_id, NULL, p_type, p_title, p_message, p_metadata);

  RETURN jsonb_build_object('ok', true);

EXCEPTION WHEN others THEN
  RAISE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.send_notification(UUID, TEXT, TEXT, TEXT, JSONB) TO authenticated;

COMMENT ON FUNCTION public.send_notification(UUID, TEXT, TEXT, TEXT, JSONB) IS
  'SECURITY DEFINER RPC for cross-party notifications. '
  'Validates that an active relationship (option_request, recruiting_thread, or '
  'B2B connection) exists between the caller and the target user before inserting. '
  'Use direct INSERT on notifications for self-targeting or org-wide notifications.';


-- ─── Verification ─────────────────────────────────────────────────────────────

SELECT policyname, cmd, with_check
FROM   pg_policies
WHERE  schemaname = 'public'
  AND  tablename  = 'notifications'
ORDER  BY policyname;

SELECT routine_name
FROM   information_schema.routines
WHERE  routine_schema = 'public'
  AND  routine_name   = 'send_notification';
