-- ============================================================================
-- Security Audit 2026-04 — Fixes for H1, H2, K4
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- K4: accept_guest_link_tos — allows anonymous guests to record ToS acceptance
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.accept_guest_link_tos(p_link_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_link_exists BOOLEAN;
BEGIN
  -- Validate the link is active and not expired/deleted before recording consent.
  SELECT EXISTS (
    SELECT 1
    FROM guest_links
    WHERE id = p_link_id
      AND is_active = TRUE
      AND deleted_at IS NULL
      AND (expires_at IS NULL OR expires_at > NOW())
  ) INTO v_link_exists;

  IF NOT v_link_exists THEN
    RETURN FALSE;
  END IF;

  UPDATE guest_links
  SET tos_accepted_by_guest = TRUE
  WHERE id = p_link_id
    AND deleted_at IS NULL;

  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.accept_guest_link_tos(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_guest_link_tos(UUID) TO anon, authenticated;


-- ────────────────────────────────────────────────────────────────────────────
-- H1: Harden log_audit_action — validate p_org_id against caller's membership
-- ────────────────────────────────────────────────────────────────────────────
-- Replaces the existing function. The function is SECURITY DEFINER so it can
-- write to audit_trail; we add an org membership check to prevent crafted
-- entries with a foreign org_id.

DROP FUNCTION IF EXISTS public.log_audit_action(UUID, TEXT, TEXT, UUID, JSONB, JSONB, TEXT);

CREATE OR REPLACE FUNCTION public.log_audit_action(
  p_org_id      UUID,
  p_action_type TEXT,
  p_entity_type TEXT  DEFAULT NULL,
  p_entity_id   UUID  DEFAULT NULL,
  p_old_data    JSONB DEFAULT NULL,
  p_new_data    JSONB DEFAULT NULL,
  p_ip_address  TEXT  DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
BEGIN
  -- Admins may log on behalf of any org.
  IF EXISTS (
    SELECT 1 FROM profiles WHERE id = v_caller_id AND is_admin = TRUE
  ) THEN
    -- Admin path: no org membership check required.
    NULL;
  ELSIF p_org_id IS NOT NULL THEN
    -- Normal users: enforce org membership to prevent cross-org audit spoofing.
    IF NOT EXISTS (
      SELECT 1
      FROM organization_members
      WHERE user_id = v_caller_id
        AND organization_id = p_org_id
    ) THEN
      RAISE EXCEPTION 'permission_denied: caller is not a member of the specified organization'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  INSERT INTO audit_trail (
    user_id,
    org_id,
    action_type,
    entity_type,
    entity_id,
    old_data,
    new_data,
    ip_address,
    created_at
  ) VALUES (
    v_caller_id,
    p_org_id,
    p_action_type,
    p_entity_type,
    p_entity_id,
    p_old_data,
    p_new_data,
    p_ip_address,
    NOW()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.log_audit_action(UUID, TEXT, TEXT, UUID, JSONB, JSONB, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_audit_action(UUID, TEXT, TEXT, UUID, JSONB, JSONB, TEXT) TO authenticated;


-- ────────────────────────────────────────────────────────────────────────────
-- H2: Booking event status-transition enforcement via DB trigger
-- ────────────────────────────────────────────────────────────────────────────
-- Mirrors the TypeScript ALLOWED_TRANSITIONS on the server side.
-- A direct API update that skips the frontend state-machine check is rejected.

CREATE OR REPLACE FUNCTION public.fn_validate_booking_event_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only enforce when status actually changes.
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  -- Allowed transitions (mirrors TypeScript ALLOWED_TRANSITIONS):
  --   pending        → agency_accepted | cancelled
  --   agency_accepted→ model_confirmed | cancelled
  --   model_confirmed→ completed       | cancelled
  --   completed      → (none)
  --   cancelled      → (none)
  IF NOT (
    (OLD.status = 'pending'         AND NEW.status IN ('agency_accepted', 'cancelled'))   OR
    (OLD.status = 'agency_accepted' AND NEW.status IN ('model_confirmed', 'cancelled'))   OR
    (OLD.status = 'model_confirmed' AND NEW.status IN ('completed',       'cancelled'))
  ) THEN
    RAISE EXCEPTION 'invalid_booking_transition: % → % is not allowed', OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_booking_event_transition ON public.booking_events;
CREATE TRIGGER trg_validate_booking_event_transition
  BEFORE UPDATE ON public.booking_events
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_validate_booking_event_transition();
