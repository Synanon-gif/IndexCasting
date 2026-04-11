-- =============================================================================
-- N-2 Fix: SECURITY DEFINER RPC for booking-event org notifications.
--
-- Problem: notifyBookingStatusChange uses direct INSERT via createNotification
-- fallback path. When a MODEL triggers model_confirmed, it is not a member of
-- the agency/client org → INSERT policy blocks → notification silently fails.
--
-- Solution: New notify_org_for_booking_event RPC (same pattern as
-- notify_org_for_option_request) that validates the caller is a participant
-- of the booking (agency member, client org member, or linked model user).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.notify_org_for_booking_event(
  p_booking_id              UUID,
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
  v_uid          UUID := auth.uid();
  bk             RECORD;
  v_ok           BOOLEAN := false;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT *
    INTO bk
  FROM public.booking_events
  WHERE id = p_booking_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'booking_event_not_found';
  END IF;

  -- Agency org member may target client org
  IF NOT v_ok AND bk.agency_org_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.organization_members om
      WHERE om.organization_id = bk.agency_org_id
        AND om.user_id = v_uid
    ) THEN
      IF bk.client_org_id IS NOT NULL AND p_target_organization_id = bk.client_org_id THEN
        v_ok := true;
      END IF;
    END IF;
  END IF;

  -- Client org member may target agency org
  IF NOT v_ok AND bk.client_org_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.organization_members om
      WHERE om.organization_id = bk.client_org_id
        AND om.user_id = v_uid
    ) THEN
      IF bk.agency_org_id IS NOT NULL AND p_target_organization_id = bk.agency_org_id THEN
        v_ok := true;
      END IF;
    END IF;
  END IF;

  -- Linked model user may target agency org or client org
  IF NOT v_ok AND bk.model_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.models m
      WHERE m.id = bk.model_id AND m.user_id = v_uid
    ) THEN
      IF p_target_organization_id IN (bk.agency_org_id, bk.client_org_id) THEN
        v_ok := true;
      END IF;
    END IF;
  END IF;

  IF NOT v_ok THEN
    RAISE EXCEPTION 'notify_org_for_booking_event: not_authorized';
  END IF;

  INSERT INTO public.notifications (user_id, organization_id, type, title, message, metadata)
  VALUES (NULL, p_target_organization_id, p_type, p_title, p_message, COALESCE(p_metadata, '{}'::JSONB));

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.notify_org_for_booking_event(UUID, UUID, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.notify_org_for_booking_event(UUID, UUID, TEXT, TEXT, TEXT, JSONB) TO authenticated;

COMMENT ON FUNCTION public.notify_org_for_booking_event IS
  'SECURITY DEFINER: insert org-scoped notification for booking_event participants. '
  'Caller must be agency member, client org member, or linked model user for the booking.';
