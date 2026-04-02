-- =============================================================================
-- Security Audit Fixes — 2026-04
--
-- Addresses vulnerabilities identified in the 2026-04 Penetration Test:
--
--   VULN-01 (CRITICAL): can_access_platform() — status='trialing' passes the
--     subscription_active check even after trial_ends_at has expired, because
--     the status is never automatically updated when no Stripe subscription
--     exists (local-only trial). Fix: remove 'trialing' from the second check.
--     A valid trial is already handled by the trial_active branch
--     (trial_ends_at > now()). Only a confirmed paid 'active' subscription
--     passes the second gate.
--
--   VULN-04 (HIGH): agency_invitations UPDATE policy — the branch
--     `agency_id IS NULL` allows any agent to update all legacy invitation rows
--     regardless of agency ownership (DoS vector: mark competitors' invites as
--     used). Fix: restrict UPDATE to own-agency rows only (agency_id IS NOT NULL
--     and belonging to caller's org). Legacy NULL-agency rows become read-only
--     for agents.
--
--   VULN-06 (MEDIUM): can_access_platform() — LIMIT 1 without ORDER BY is
--     non-deterministic when a user somehow has multiple org memberships
--     (legacy data, admin override). Fix: add ORDER BY om.created_at ASC so
--     the oldest (primary) membership is always selected deterministically.
--
--   VULN-09 (MEDIUM): admin_update_profile_full — p_role accepts arbitrary
--     strings; an admin could set an invalid or future role value.
--     Fix: validate p_role against the allowed enum values before the UPDATE.
--
-- Run AFTER migration_client_paywall.sql.
-- =============================================================================


-- ─── VULN-01 + VULN-06: Replace can_access_platform() ────────────────────────
--
-- Critical changes vs. the previous version (migration_client_paywall.sql):
--   1. ORDER BY om.created_at ASC added to the LIMIT 1 query (VULN-06).
--   2. Subscription-active check now uses status = 'active' ONLY — 'trialing'
--      is removed. A valid trial is already caught by the trial_active branch
--      above it. An expired local trial (status='trialing', date in past, no
--      Stripe subscription) now correctly returns allowed=false. (VULN-01)

CREATE OR REPLACE FUNCTION public.can_access_platform()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id   UUID;
  v_org_type TEXT;  -- 'agency' | 'client'
  v_override admin_overrides%ROWTYPE;
  v_sub      organization_subscriptions%ROWTYPE;
BEGIN
  -- Resolve org_id AND org_type from auth.uid().
  -- ORDER BY created_at ASC → oldest membership wins (deterministic, VULN-06).
  SELECT om.organization_id, o.type
  INTO   v_org_id, v_org_type
  FROM   organization_members om
  JOIN   organizations o ON o.id = om.organization_id
  WHERE  om.user_id = auth.uid()
  ORDER BY om.created_at ASC
  LIMIT  1;

  IF v_org_id IS NULL THEN
    RETURN jsonb_build_object(
      'allowed',  false,
      'reason',   'no_org',
      'org_type', NULL
    );
  END IF;

  -- ── 1. Admin override ────────────────────────────────────────────────────
  SELECT * INTO v_override
  FROM   admin_overrides
  WHERE  organization_id = v_org_id;

  IF FOUND AND v_override.bypass_paywall THEN
    RETURN jsonb_build_object(
      'allowed',         true,
      'reason',          'admin_override',
      'plan',            COALESCE(v_override.custom_plan, 'admin'),
      'organization_id', v_org_id,
      'org_type',        v_org_type
    );
  END IF;

  -- ── 2. Subscription / trial ───────────────────────────────────────────────
  SELECT * INTO v_sub
  FROM   organization_subscriptions
  WHERE  organization_id = v_org_id;

  IF FOUND THEN
    -- Trial active: explicit date check. Only this branch allows 'trialing' status.
    -- Orgs with status='trialing' but trial_ends_at in the past fall through to
    -- the subscription check below, which requires status='active'. (VULN-01)
    IF v_sub.trial_ends_at > now() THEN
      RETURN jsonb_build_object(
        'allowed',         true,
        'reason',          'trial_active',
        'trial_ends_at',   v_sub.trial_ends_at,
        'plan',            COALESCE(v_sub.plan, 'trial'),
        'organization_id', v_org_id,
        'org_type',        v_org_type
      );
    END IF;

    -- Paid subscription active: ONLY status='active' qualifies.
    -- 'trialing' without a valid trial date is NOT accepted here. (VULN-01 fix)
    IF v_sub.status = 'active' THEN
      RETURN jsonb_build_object(
        'allowed',         true,
        'reason',          'subscription_active',
        'plan',            COALESCE(v_sub.plan, 'unknown'),
        'organization_id', v_org_id,
        'org_type',        v_org_type
      );
    END IF;
  END IF;

  -- ── 3. No access ─────────────────────────────────────────────────────────
  RETURN jsonb_build_object(
    'allowed',         false,
    'reason',          'no_active_subscription',
    'organization_id', v_org_id,
    'org_type',        v_org_type
  );
END;
$$;

REVOKE ALL    ON FUNCTION public.can_access_platform() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_access_platform() TO authenticated;

COMMENT ON FUNCTION public.can_access_platform() IS
  'THE access gate. Resolves org from auth.uid() (cannot be spoofed). '
  'Grants access if: (1) admin_override.bypass_paywall=true, '
  '(2) trial_ends_at > now(), or (3) status=''active'' (paid subscription). '
  'status=''trialing'' without an active trial date is DENIED. (VULN-01 fix 2026-04) '
  'ORDER BY created_at ASC ensures deterministic org selection. (VULN-06 fix 2026-04)';


-- ─── VULN-04: Tighten agency_invitations UPDATE policy ───────────────────────
--
-- Before: any agent can UPDATE rows where agency_id IS NULL (all legacy rows)
--         → DoS: mark competitors' invites as used.
-- After: UPDATE restricted to rows where agency_id IS NOT NULL AND belongs to
--        the caller's own agency. Legacy NULL-agency rows are now read-only.

DROP POLICY IF EXISTS "Agents can update own agency invitations" ON public.agency_invitations;

CREATE POLICY "Agents can update own agency invitations"
  ON public.agency_invitations FOR UPDATE TO authenticated
  USING (
    -- Caller must be an agent
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'agent'
    )
    -- Row must be linked to the caller's own agency (NULL-agency rows excluded)
    AND agency_id IS NOT NULL
    AND (
      EXISTS (
        SELECT 1 FROM public.agencies ag
        JOIN   public.organizations o  ON o.agency_id = ag.id
        JOIN   public.organization_members om ON om.organization_id = o.id
        WHERE  ag.id = agency_invitations.agency_id AND om.user_id = auth.uid()
      )
      OR EXISTS (
        SELECT 1 FROM public.agencies ag
        JOIN   public.organizations o ON o.agency_id = ag.id
        WHERE  ag.id = agency_invitations.agency_id AND o.owner_id = auth.uid()
      )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'agent'
    )
  );

COMMENT ON POLICY "Agents can update own agency invitations" ON public.agency_invitations IS
  'UPDATE restricted to own-agency rows with a non-NULL agency_id. '
  'Legacy rows (agency_id IS NULL) are now read-only for all agents. (VULN-04 fix 2026-04)';


-- ─── VULN-09: Add role allowlist check to admin_update_profile_full ───────────
--
-- Before: p_role accepted any string → admin could set role='superadmin' etc.
-- After: p_role validated against the application role enum before the UPDATE.

CREATE OR REPLACE FUNCTION public.admin_update_profile_full(
  target_id UUID,
  p_display_name TEXT DEFAULT NULL,
  p_email TEXT DEFAULT NULL,
  p_company_name TEXT DEFAULT NULL,
  p_phone TEXT DEFAULT NULL,
  p_website TEXT DEFAULT NULL,
  p_country TEXT DEFAULT NULL,
  p_role TEXT DEFAULT NULL,
  p_is_active BOOLEAN DEFAULT NULL,
  p_is_admin BOOLEAN DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_is_admin BOOLEAN;
BEGIN
  SELECT is_admin INTO caller_is_admin FROM public.profiles WHERE id = auth.uid();
  IF NOT COALESCE(caller_is_admin, false) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  -- VULN-09 fix: validate role against the application enum before applying.
  IF p_role IS NOT NULL AND p_role NOT IN ('agent', 'model', 'client', 'apply') THEN
    RAISE EXCEPTION 'admin_update_profile_full: invalid role value ''%''. Allowed: agent, model, client, apply', p_role;
  END IF;

  UPDATE public.profiles
  SET
    display_name = COALESCE(p_display_name, display_name),
    email        = COALESCE(p_email, email),
    company_name = COALESCE(p_company_name, company_name),
    phone        = COALESCE(p_phone, phone),
    website      = COALESCE(p_website, website),
    country      = COALESCE(p_country, country),
    role         = COALESCE(p_role, role),
    is_active    = COALESCE(p_is_active, is_active),
    updated_at   = now()
  WHERE id = target_id;

  INSERT INTO public.admin_logs (admin_id, action, target_user_id, details)
  VALUES (
    auth.uid(),
    'profile_edit',
    target_id,
    jsonb_build_object(
      'display_name', p_display_name, 'email', p_email, 'company_name', p_company_name,
      'phone', p_phone, 'website', p_website, 'country', p_country,
      'role', p_role, 'is_active', p_is_active
    )
  );

  RETURN true;
END;
$$;

COMMENT ON FUNCTION public.admin_update_profile_full IS
  'Admin only. Updates profile fields; does NOT change is_admin (prevent privilege '
  'escalation from the app). p_role is validated against allowed enum values. '
  '(VULN-09 fix 2026-04)';


-- ─── Verification queries ─────────────────────────────────────────────────────

SELECT routine_name, routine_definition
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name = 'can_access_platform';

SELECT policyname, cmd, qual
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename  = 'agency_invitations'
  AND policyname = 'Agents can update own agency invitations';
