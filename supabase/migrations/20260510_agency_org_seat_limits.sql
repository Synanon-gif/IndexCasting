-- =============================================================================
-- Agency org seat limits (plan-based): max organization_members rows per agency org.
-- Trial + agency_basic: 2 | agency_pro: 4 | agency_enterprise + admin override: unlimited (NULL)
-- Enforcement: BEFORE INSERT on organization_members (agency only) and invitations (agency booker only).
-- Does NOT change can_access_platform() order or semantics.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_agency_organization_seat_limit(p_organization_id uuid)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_type          text;
  v_override      public.admin_overrides%ROWTYPE;
  v_sub           public.organization_subscriptions%ROWTYPE;
BEGIN
  SELECT o.type INTO v_type
  FROM public.organizations o
  WHERE o.id = p_organization_id;

  IF v_type IS DISTINCT FROM 'agency' THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_override
  FROM public.admin_overrides
  WHERE organization_id = p_organization_id;

  IF FOUND AND v_override.bypass_paywall THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_sub
  FROM public.organization_subscriptions
  WHERE organization_id = p_organization_id;

  IF FOUND AND v_sub.trial_ends_at > now() THEN
    RETURN 2;
  END IF;

  IF FOUND AND v_sub.status IN ('active', 'trialing') THEN
    CASE COALESCE(v_sub.plan, '')
      WHEN 'agency_basic' THEN RETURN 2;
      WHEN 'agency_pro' THEN RETURN 4;
      WHEN 'agency_enterprise' THEN RETURN NULL;
      ELSE RETURN 2;
    END CASE;
  END IF;

  -- No active subscription row / expired: conservative cap (matches basic tier intent)
  RETURN 2;
END;
$$;

REVOKE ALL ON FUNCTION public.get_agency_organization_seat_limit(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_agency_organization_seat_limit(uuid) TO authenticated;

COMMENT ON FUNCTION public.get_agency_organization_seat_limit(uuid) IS
  'Returns max agency org member seats (organization_members rows). NULL = unlimited. SECURITY DEFINER row_security off.';

-- ─── BEFORE INSERT: organization_members ─────────────────────────────────────

CREATE OR REPLACE FUNCTION public.enforce_agency_org_member_seat_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_type  text;
  v_limit integer;
  v_cnt   integer;
BEGIN
  SELECT o.type INTO v_type
  FROM public.organizations o
  WHERE o.id = NEW.organization_id;

  IF v_type IS DISTINCT FROM 'agency' THEN
    RETURN NEW;
  END IF;

  v_limit := public.get_agency_organization_seat_limit(NEW.organization_id);
  IF v_limit IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT count(*)::int INTO v_cnt
  FROM public.organization_members
  WHERE organization_id = NEW.organization_id;

  IF v_cnt + 1 > v_limit THEN
    RAISE EXCEPTION 'agency_member_limit_reached'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_agency_org_member_seat_limit ON public.organization_members;
CREATE TRIGGER trg_enforce_agency_org_member_seat_limit
  BEFORE INSERT ON public.organization_members
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_agency_org_member_seat_limit();

-- ─── BEFORE INSERT: invitations (agency booker — reserves a seat until accept/expiry) ─

CREATE OR REPLACE FUNCTION public.enforce_agency_org_invitation_seat_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_type    text;
  v_limit   integer;
  v_members integer;
  v_pending integer;
BEGIN
  SELECT o.type INTO v_type
  FROM public.organizations o
  WHERE o.id = NEW.organization_id;

  IF v_type IS DISTINCT FROM 'agency' THEN
    RETURN NEW;
  END IF;

  IF NEW.role IS DISTINCT FROM 'booker'::public.invitation_org_role THEN
    RETURN NEW;
  END IF;

  v_limit := public.get_agency_organization_seat_limit(NEW.organization_id);
  IF v_limit IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT count(*)::int INTO v_members
  FROM public.organization_members
  WHERE organization_id = NEW.organization_id;

  SELECT count(*)::int INTO v_pending
  FROM public.invitations
  WHERE organization_id = NEW.organization_id
    AND role = 'booker'
    AND status = 'pending'
    AND expires_at > now();

  IF v_members + v_pending + 1 > v_limit THEN
    RAISE EXCEPTION 'agency_member_limit_reached'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_agency_org_invitation_seat_limit ON public.invitations;
CREATE TRIGGER trg_enforce_agency_org_invitation_seat_limit
  BEFORE INSERT ON public.invitations
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_agency_org_invitation_seat_limit();
