-- P2 FRAGILE: Unify all 21 admin RPCs to use PERFORM assert_is_admin()
-- instead of inline profiles.is_admin checks.
--
-- Problem: profiles.is_admin direct access is fragile (Gefahr 1):
--   - Column REVOKE from authenticated would break the guard
--   - No UUID+email pinning (defense-in-depth)
--   - No failed attempt logging
--   - Inconsistent with assert_is_admin() pattern used in newer RPCs
--
-- Fix: Replace all inline is_admin checks with PERFORM assert_is_admin()
-- which internally calls is_current_user_admin() (UUID+email pin, row_security=off).
-- Also add SET row_security TO off for consistency (project rule §I).
--
-- All function signatures remain IDENTICAL — no frontend changes needed.

-- ── admin_get_profiles ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_get_profiles(p_active_only boolean DEFAULT NULL::boolean, p_inactive_only boolean DEFAULT NULL::boolean, p_role text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, email text, display_name text, role text, is_active boolean, is_admin boolean, tos_accepted boolean, privacy_accepted boolean, agency_model_rights_accepted boolean, activation_documents_sent boolean, verification_email text, company_name text, phone text, country text, created_at timestamp with time zone, deactivated_at timestamp with time zone, deactivated_reason text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET row_security TO off
AS $function$
BEGIN
  PERFORM public.assert_is_admin();

  RETURN QUERY
  SELECT
    pr.id,
    pr.email,
    pr.display_name,
    pr.role::text,
    pr.is_active,
    pr.is_admin,
    pr.tos_accepted,
    pr.privacy_accepted,
    pr.agency_model_rights_accepted,
    pr.activation_documents_sent,
    pr.verification_email,
    pr.company_name,
    pr.phone,
    pr.country,
    pr.created_at,
    pr.deactivated_at,
    pr.deactivated_reason
  FROM public.profiles pr
  WHERE
    (p_active_only   IS NULL OR (p_active_only   = TRUE  AND pr.is_active = TRUE))
    AND (p_inactive_only IS NULL OR (p_inactive_only = TRUE  AND pr.is_active = FALSE))
    AND (p_role          IS NULL OR pr.role::text = p_role)
  ORDER BY pr.created_at DESC;
END;
$function$;

-- ── admin_list_all_models ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_list_all_models()
 RETURNS TABLE(id uuid, name text, email text, agency_id uuid, user_id uuid, is_active boolean, admin_notes text, created_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET row_security TO off
AS $function$
BEGIN
  PERFORM public.assert_is_admin();

  RETURN QUERY
  SELECT m.id, m.name, m.email, m.agency_id, m.user_id, m.is_active, m.admin_notes, m.created_at
  FROM public.models m
  ORDER BY m.name;
END;
$function$;

-- ── admin_list_org_memberships ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_list_org_memberships(p_target_user_id uuid)
 RETURNS TABLE(organization_id uuid, org_name text, org_type text, member_role org_member_role)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET row_security TO off
AS $function$
BEGIN
  PERFORM public.assert_is_admin();

  RETURN QUERY
  SELECT o.id, o.name, o.type::text, m.role
  FROM public.organization_members m
  JOIN public.organizations o ON o.id = m.organization_id
  WHERE m.user_id = p_target_user_id
  ORDER BY o.name;
END;
$function$;

-- ── admin_list_organizations ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_list_organizations()
 RETURNS TABLE(id uuid, name text, type text, owner_id uuid, is_active boolean, admin_notes text, member_count bigint, created_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET row_security TO off
AS $function$
BEGIN
  PERFORM public.assert_is_admin();

  RETURN QUERY
  SELECT
    o.id,
    o.name,
    o.type::text,
    o.owner_id,
    o.is_active,
    o.admin_notes,
    COUNT(m.user_id)::BIGINT AS member_count,
    o.created_at
  FROM public.organizations o
  LEFT JOIN public.organization_members m ON m.organization_id = o.id
  GROUP BY o.id, o.name, o.type, o.owner_id, o.is_active, o.admin_notes, o.created_at
  ORDER BY o.name;
END;
$function$;

-- ── admin_reset_agency_swipe_count ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_reset_agency_swipe_count(p_organization_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET row_security TO off
AS $function$
BEGIN
  PERFORM public.assert_is_admin();

  UPDATE agency_usage_limits
  SET    swipes_used_today = 0,
         last_reset_date   = CURRENT_DATE,
         updated_at        = now()
  WHERE  organization_id = p_organization_id;
END;
$function$;

-- ── admin_reset_to_default_storage_limit ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_reset_to_default_storage_limit(p_organization_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET row_security TO off
AS $function$
BEGIN
  PERFORM public.assert_is_admin();

  INSERT INTO organization_storage_usage (organization_id, used_bytes, storage_limit_bytes, is_unlimited)
  VALUES (p_organization_id, 0, NULL, false)
  ON CONFLICT (organization_id) DO UPDATE
    SET storage_limit_bytes = NULL,
        is_unlimited        = false,
        updated_at          = now();
END;
$function$;

-- ── admin_set_account_active ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_set_account_active(target_id uuid, active boolean, reason text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET row_security TO off
AS $function$
BEGIN
  PERFORM public.assert_is_admin();

  UPDATE public.profiles
  SET is_active = active,
      deactivated_at = CASE WHEN NOT active THEN now() ELSE NULL END,
      deactivated_reason = CASE WHEN NOT active THEN reason ELSE NULL END,
      updated_at = now()
  WHERE id = target_id;

  INSERT INTO public.admin_logs (admin_id, action, target_user_id, details)
  VALUES (
    auth.uid(),
    CASE WHEN active THEN 'activate_account' ELSE 'deactivate_account' END,
    target_id,
    jsonb_build_object('reason', reason)
  );

  RETURN true;
END;
$function$;

-- ── admin_set_agency_storage_usage ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_set_agency_storage_usage(p_organization_id uuid, p_used_bytes bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET row_security TO off
AS $function$
BEGIN
  PERFORM public.assert_is_admin();

  IF p_used_bytes < 0 THEN
    RAISE EXCEPTION 'admin_set_agency_storage_usage: used_bytes must be >= 0';
  END IF;

  INSERT INTO organization_storage_usage (organization_id, used_bytes)
  VALUES (p_organization_id, p_used_bytes)
  ON CONFLICT (organization_id) DO UPDATE
    SET used_bytes = p_used_bytes,
        updated_at = now();
END;
$function$;

-- ── admin_set_agency_swipe_limit ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_set_agency_swipe_limit(p_organization_id uuid, p_limit integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET row_security TO off
AS $function$
BEGIN
  PERFORM public.assert_is_admin();

  IF p_limit < 0 THEN
    RAISE EXCEPTION 'admin_set_agency_swipe_limit: limit must be >= 0';
  END IF;

  INSERT INTO agency_usage_limits (organization_id, daily_swipe_limit, swipes_used_today, last_reset_date)
  VALUES (p_organization_id, p_limit, 0, CURRENT_DATE)
  ON CONFLICT (organization_id) DO UPDATE
    SET daily_swipe_limit = p_limit,
        updated_at        = now();
END;
$function$;

-- ── admin_set_bypass_paywall ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_set_bypass_paywall(p_org_id uuid, p_bypass boolean, p_custom_plan text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET row_security TO off
AS $function$
DECLARE
  v_prev_bypass      BOOLEAN;
  v_prev_custom_plan TEXT;
BEGIN
  PERFORM public.assert_is_admin();

  IF NOT EXISTS (SELECT 1 FROM organizations WHERE id = p_org_id) THEN
    RAISE EXCEPTION 'admin_set_bypass_paywall: organization not found';
  END IF;

  SELECT bypass_paywall, custom_plan
  INTO   v_prev_bypass, v_prev_custom_plan
  FROM   admin_overrides
  WHERE  organization_id = p_org_id;

  INSERT INTO admin_overrides (organization_id, bypass_paywall, custom_plan, updated_at)
  VALUES (p_org_id, p_bypass, p_custom_plan, now())
  ON CONFLICT (organization_id) DO UPDATE
    SET bypass_paywall = p_bypass,
        custom_plan    = p_custom_plan,
        updated_at     = now();

  INSERT INTO public.admin_logs (admin_id, action, details)
  VALUES (
    auth.uid(),
    'set_bypass_paywall',
    jsonb_build_object(
      'organization_id',      p_org_id,
      'bypass_paywall',       p_bypass,
      'custom_plan',          p_custom_plan,
      'previous_bypass',      v_prev_bypass,
      'previous_custom_plan', v_prev_custom_plan
    )
  );
END;
$function$;

-- ── admin_set_model_active ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_set_model_active(p_model_id uuid, p_active boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET row_security TO off
AS $function$
BEGIN
  PERFORM public.assert_is_admin();

  UPDATE public.models SET is_active = p_active WHERE id = p_model_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'model not found: %', p_model_id;
  END IF;

  INSERT INTO public.admin_logs (admin_id, action, details)
  VALUES (
    auth.uid(),
    'admin_set_model_active',
    jsonb_build_object('model_id', p_model_id, 'is_active', p_active)
  );

  RETURN TRUE;
END;
$function$;

-- ── admin_set_org_active ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_set_org_active(p_org_id uuid, p_active boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET row_security TO off
AS $function$
BEGIN
  PERFORM public.assert_is_admin();

  UPDATE public.organizations SET is_active = p_active WHERE id = p_org_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'organization not found: %', p_org_id;
  END IF;

  INSERT INTO public.admin_logs (admin_id, action, details)
  VALUES (
    auth.uid(),
    'admin_set_org_active',
    jsonb_build_object('org_id', p_org_id, 'is_active', p_active)
  );

  RETURN TRUE;
END;
$function$;

-- ── admin_set_org_plan ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_set_org_plan(p_org_id uuid, p_plan text, p_status text DEFAULT 'active'::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET row_security TO off
AS $function$
DECLARE
  v_prev_plan   TEXT;
  v_prev_status TEXT;
BEGIN
  PERFORM public.assert_is_admin();

  IF p_plan NOT IN ('agency_basic', 'agency_pro', 'agency_enterprise', 'client') THEN
    RAISE EXCEPTION 'admin_set_org_plan: invalid plan %', p_plan;
  END IF;

  IF p_status NOT IN ('trialing', 'active', 'past_due', 'canceled') THEN
    RAISE EXCEPTION 'admin_set_org_plan: invalid status %', p_status;
  END IF;

  SELECT plan, status
  INTO   v_prev_plan, v_prev_status
  FROM   organization_subscriptions
  WHERE  organization_id = p_org_id;

  INSERT INTO organization_subscriptions (organization_id, plan, status, trial_ends_at)
  VALUES (p_org_id, p_plan, p_status, now())
  ON CONFLICT (organization_id) DO UPDATE
    SET plan   = p_plan,
        status = p_status;

  IF p_plan IN ('agency_basic', 'agency_pro', 'agency_enterprise') THEN
    INSERT INTO agency_usage_limits (organization_id, daily_swipe_limit, swipes_used_today, last_reset_date)
    VALUES (p_org_id, public.get_plan_swipe_limit(p_plan), 0, CURRENT_DATE)
    ON CONFLICT (organization_id) DO UPDATE
      SET daily_swipe_limit = public.get_plan_swipe_limit(p_plan),
          updated_at        = now();
  END IF;

  INSERT INTO public.admin_logs (admin_id, action, details)
  VALUES (
    auth.uid(),
    'set_org_plan',
    jsonb_build_object(
      'organization_id', p_org_id,
      'plan',            p_plan,
      'status',          p_status,
      'previous_plan',   v_prev_plan,
      'previous_status', v_prev_status
    )
  );
END;
$function$;

-- ── admin_set_organization_member_role ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_set_organization_member_role(p_target_user_id uuid, p_organization_id uuid, p_role org_member_role)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET row_security TO off
AS $function$
DECLARE
  org_kind public.organization_type;
  old_owner_id UUID;
  demoted_role public.org_member_role;
BEGIN
  PERFORM public.assert_is_admin();

  SELECT type INTO org_kind FROM public.organizations WHERE id = p_organization_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'organization not found';
  END IF;

  IF p_role = 'owner' THEN
    demoted_role := CASE WHEN org_kind = 'agency' THEN 'booker'::public.org_member_role ELSE 'employee'::public.org_member_role END;
    SELECT user_id INTO old_owner_id
    FROM public.organization_members
    WHERE organization_id = p_organization_id AND role = 'owner'
    LIMIT 1;
    IF old_owner_id IS NOT NULL AND old_owner_id IS DISTINCT FROM p_target_user_id THEN
      UPDATE public.organization_members
      SET role = demoted_role
      WHERE organization_id = p_organization_id AND user_id = old_owner_id;
    END IF;
  END IF;

  UPDATE public.organization_members
  SET role = p_role
  WHERE user_id = p_target_user_id AND organization_id = p_organization_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'membership not found';
  END IF;

  INSERT INTO public.admin_logs (admin_id, action, target_user_id, details)
  VALUES (
    auth.uid(),
    'admin_set_organization_member_role',
    p_target_user_id,
    jsonb_build_object('organization_id', p_organization_id, 'role', p_role::text)
  );

  RETURN true;
END;
$function$;

-- ── admin_set_storage_limit ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_set_storage_limit(p_organization_id uuid, p_new_limit_bytes bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET row_security TO off
AS $function$
BEGIN
  PERFORM public.assert_is_admin();

  IF p_new_limit_bytes <= 0 THEN
    RAISE EXCEPTION 'admin_set_storage_limit: limit must be greater than 0 bytes';
  END IF;

  IF p_new_limit_bytes > 1099511627776 THEN
    RAISE EXCEPTION 'admin_set_storage_limit: limit cannot exceed 1 TB (1099511627776 bytes)';
  END IF;

  INSERT INTO organization_storage_usage (organization_id, used_bytes, storage_limit_bytes, is_unlimited)
  VALUES (p_organization_id, 0, p_new_limit_bytes, false)
  ON CONFLICT (organization_id) DO UPDATE
    SET storage_limit_bytes = p_new_limit_bytes,
        is_unlimited        = false,
        updated_at          = now();
END;
$function$;

-- ── admin_set_unlimited_storage ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_set_unlimited_storage(p_organization_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET row_security TO off
AS $function$
BEGIN
  PERFORM public.assert_is_admin();

  INSERT INTO organization_storage_usage (organization_id, used_bytes, storage_limit_bytes, is_unlimited)
  VALUES (p_organization_id, 0, NULL, true)
  ON CONFLICT (organization_id) DO UPDATE
    SET is_unlimited        = true,
        storage_limit_bytes = NULL,
        updated_at          = now();
END;
$function$;

-- ── admin_update_model_notes ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_update_model_notes(p_model_id uuid, p_admin_notes text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET row_security TO off
AS $function$
BEGIN
  PERFORM public.assert_is_admin();

  UPDATE public.models SET admin_notes = p_admin_notes WHERE id = p_model_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'model not found: %', p_model_id;
  END IF;

  INSERT INTO public.admin_logs (admin_id, action, details)
  VALUES (
    auth.uid(),
    'admin_update_model_notes',
    jsonb_build_object('model_id', p_model_id, 'notes_cleared', (p_admin_notes IS NULL))
  );

  RETURN TRUE;
END;
$function$;

-- ── admin_update_org_details ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_update_org_details(p_org_id uuid, p_name text DEFAULT NULL::text, p_new_owner_id uuid DEFAULT NULL::uuid, p_admin_notes text DEFAULT NULL::text, p_clear_notes boolean DEFAULT false)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET row_security TO off
AS $function$
DECLARE
  org_kind     public.organization_type;
  old_owner_id UUID;
  demoted_role public.org_member_role;
BEGIN
  PERFORM public.assert_is_admin();

  SELECT type INTO org_kind FROM public.organizations WHERE id = p_org_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'organization not found: %', p_org_id;
  END IF;

  IF p_name IS NOT NULL THEN
    UPDATE public.organizations SET name = p_name WHERE id = p_org_id;
  END IF;

  IF p_clear_notes THEN
    UPDATE public.organizations SET admin_notes = NULL WHERE id = p_org_id;
  ELSIF p_admin_notes IS NOT NULL THEN
    UPDATE public.organizations SET admin_notes = p_admin_notes WHERE id = p_org_id;
  END IF;

  IF p_new_owner_id IS NOT NULL THEN
    demoted_role := CASE
      WHEN org_kind = 'agency' THEN 'booker'::public.org_member_role
      ELSE                          'employee'::public.org_member_role
    END;

    SELECT user_id INTO old_owner_id
    FROM public.organization_members
    WHERE organization_id = p_org_id AND role = 'owner'
    LIMIT 1;

    IF old_owner_id IS NOT NULL AND old_owner_id IS DISTINCT FROM p_new_owner_id THEN
      UPDATE public.organization_members
      SET role = demoted_role
      WHERE organization_id = p_org_id AND user_id = old_owner_id;
    END IF;

    UPDATE public.organization_members
    SET role = 'owner'
    WHERE organization_id = p_org_id AND user_id = p_new_owner_id;

    UPDATE public.organizations
    SET owner_id = p_new_owner_id
    WHERE id = p_org_id;
  END IF;

  INSERT INTO public.admin_logs (admin_id, action, details)
  VALUES (
    auth.uid(),
    'admin_update_org_details',
    jsonb_build_object(
      'org_id',        p_org_id,
      'name_updated',  (p_name IS NOT NULL),
      'new_owner_id',  p_new_owner_id,
      'notes_updated', (p_admin_notes IS NOT NULL OR p_clear_notes)
    )
  );

  RETURN TRUE;
END;
$function$;

-- ── admin_update_profile ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_update_profile(target_id uuid, field_name text, field_value text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET row_security TO off
AS $function$
DECLARE
  old_value TEXT;
BEGIN
  PERFORM public.assert_is_admin();

  IF field_name NOT IN ('display_name', 'email', 'company_name', 'phone', 'website', 'country', 'verification_email') THEN
    RAISE EXCEPTION 'Field not allowed: %', field_name;
  END IF;

  EXECUTE format('SELECT %I::text FROM public.profiles WHERE id = $1', field_name)
    INTO old_value USING target_id;

  EXECUTE format('UPDATE public.profiles SET %I = $1, updated_at = now() WHERE id = $2', field_name)
    USING field_value, target_id;

  INSERT INTO public.admin_logs (admin_id, action, target_user_id, details)
  VALUES (
    auth.uid(),
    'update_profile_field',
    target_id,
    jsonb_build_object('field', field_name, 'old_value', old_value, 'new_value', field_value)
  );

  RETURN true;
END;
$function$;

-- ── admin_get_org_storage_usage ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_get_org_storage_usage(p_org_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET row_security TO off
AS $function$
DECLARE
  v_row            organization_storage_usage%ROWTYPE;
  v_default_limit  BIGINT := 5368709120;
  v_effective      BIGINT;
BEGIN
  PERFORM public.assert_is_admin();

  IF NOT EXISTS (SELECT 1 FROM organizations WHERE id = p_org_id) THEN
    RETURN json_build_object('error', 'Organization not found');
  END IF;

  INSERT INTO organization_storage_usage (organization_id, used_bytes)
  VALUES (p_org_id, 0)
  ON CONFLICT (organization_id) DO NOTHING;

  SELECT * INTO v_row
  FROM   organization_storage_usage
  WHERE  organization_id = p_org_id;

  IF v_row.is_unlimited THEN
    v_effective := NULL;
  ELSIF v_row.storage_limit_bytes IS NOT NULL THEN
    v_effective := v_row.storage_limit_bytes;
  ELSE
    v_effective := v_default_limit;
  END IF;

  RETURN json_build_object(
    'organization_id',       v_row.organization_id,
    'used_bytes',            v_row.used_bytes,
    'storage_limit_bytes',   v_row.storage_limit_bytes,
    'is_unlimited',          v_row.is_unlimited,
    'effective_limit_bytes', v_effective
  );
END;
$function$;

-- ── admin_get_org_subscription ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_get_org_subscription(p_org_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET row_security TO off
AS $function$
DECLARE
  v_sub      organization_subscriptions%ROWTYPE;
  v_override admin_overrides%ROWTYPE;
BEGIN
  PERFORM public.assert_is_admin();

  SELECT * INTO v_sub      FROM organization_subscriptions WHERE organization_id = p_org_id;
  SELECT * INTO v_override FROM admin_overrides             WHERE organization_id = p_org_id;

  RETURN jsonb_build_object(
    'subscription',  CASE WHEN v_sub.organization_id IS NOT NULL THEN to_jsonb(v_sub) ELSE NULL END,
    'admin_override',CASE WHEN v_override.organization_id IS NOT NULL THEN to_jsonb(v_override) ELSE NULL END
  );
END;
$function$;
