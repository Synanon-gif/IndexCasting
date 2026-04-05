-- =============================================================================
-- Admin Backfill: create org + membership for existing "NO ORG" accounts
--
-- Problem: Agency/Client accounts that signed up before the bootstrap fix
-- (or where the signup RPC failed due to missing session) have no
-- organization_members row and no organizations row. The admin sees them
-- with a "NO ORG" badge; users see "No agency assigned" everywhere.
--
-- Solution:
-- 1. admin_backfill_org_for_user(user_id) — admin-only RPC that creates the
--    missing agency/client org + owner membership for a single user, using
--    their existing agencies row (by email) or creating one if missing.
--
-- 2. admin_backfill_all_no_org_accounts() — admin-only RPC that iterates all
--    agent/client profiles with no organization_members entry and calls
--    the per-user backfill automatically.
--
-- Both functions require assert_is_admin() as first guard.
-- Both are SECURITY DEFINER with SET row_security TO off.
-- =============================================================================

-- ─── 1. Per-user backfill ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_backfill_org_for_user(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_role   text;
  v_email  text;
  v_cname  text;
  v_aid    uuid;
  v_oid    uuid;
  v_code   text;
  v_mcount int;
BEGIN
  PERFORM public.assert_is_admin();

  -- Load profile
  SELECT role::text, email, company_name
  INTO v_role, v_email, v_cname
  FROM public.profiles
  WHERE id = p_user_id;

  IF v_role IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_profile', 'user_id', p_user_id);
  END IF;

  IF v_role NOT IN ('agent', 'client') THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason', 'not_b2b', 'role', v_role);
  END IF;

  -- Already has membership → skip
  SELECT COUNT(*)::int INTO v_mcount
  FROM public.organization_members
  WHERE user_id = p_user_id;

  IF v_mcount > 0 THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason', 'has_org_membership');
  END IF;

  -- ── Client path ──────────────────────────────────────────────────────────────
  IF v_role = 'client' THEN
    -- Check for existing client org by owner_id
    SELECT id INTO v_oid
    FROM public.organizations
    WHERE owner_id = p_user_id AND type = 'client'
    LIMIT 1;

    IF v_oid IS NULL THEN
      INSERT INTO public.organizations (name, type, owner_id, agency_id)
      VALUES (COALESCE(NULLIF(trim(v_cname), ''), 'My Organization'), 'client', p_user_id, NULL)
      RETURNING id INTO v_oid;
    END IF;

    INSERT INTO public.organization_members (user_id, organization_id, role)
    VALUES (p_user_id, v_oid, 'owner')
    ON CONFLICT (user_id, organization_id) DO NOTHING;

    RETURN jsonb_build_object('ok', true, 'bootstrap', 'client_owner', 'organization_id', v_oid);
  END IF;

  -- ── Agent path ───────────────────────────────────────────────────────────────
  IF v_email IS NULL OR trim(v_email) = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'missing_email', 'user_id', p_user_id);
  END IF;

  -- Find or create agencies row by email
  SELECT id INTO v_aid
  FROM public.agencies
  WHERE lower(trim(email)) = lower(trim(v_email))
  LIMIT 1;

  IF v_aid IS NULL THEN
    v_code := 'a' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 15);
    INSERT INTO public.agencies (name, email, code)
    VALUES (COALESCE(NULLIF(trim(v_cname), ''), 'Agency'), v_email, v_code)
    RETURNING id INTO v_aid;
  END IF;

  -- Find or create organizations row for this agency
  SELECT id INTO v_oid
  FROM public.organizations
  WHERE agency_id = v_aid
  LIMIT 1;

  IF v_oid IS NULL THEN
    INSERT INTO public.organizations (name, type, owner_id, agency_id)
    VALUES (COALESCE(NULLIF(trim(v_cname), ''), 'Agency'), 'agency', p_user_id, v_aid)
    RETURNING id INTO v_oid;
  END IF;

  INSERT INTO public.organization_members (user_id, organization_id, role)
  VALUES (p_user_id, v_oid, 'owner')
  ON CONFLICT (user_id, organization_id) DO NOTHING;

  RETURN jsonb_build_object(
    'ok', true,
    'bootstrap', 'agency_owner',
    'agency_id', v_aid,
    'organization_id', v_oid
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_backfill_org_for_user(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_backfill_org_for_user(uuid) TO authenticated;

COMMENT ON FUNCTION public.admin_backfill_org_for_user(uuid) IS
  'Admin-only: creates missing agency/client org + owner membership for a single user. '
  'Requires assert_is_admin(). Safe to call multiple times (idempotent).';

-- ─── 2. Bulk backfill for all NO-ORG accounts ─────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_backfill_all_no_org_accounts()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  r          RECORD;
  v_result   jsonb;
  v_fixed    int := 0;
  v_skipped  int := 0;
  v_errors   jsonb := '[]'::jsonb;
BEGIN
  PERFORM public.assert_is_admin();

  FOR r IN
    SELECT p.id
    FROM public.profiles p
    WHERE p.role::text IN ('agent', 'client')
      AND NOT EXISTS (
        SELECT 1 FROM public.organization_members m WHERE m.user_id = p.id
      )
  LOOP
    BEGIN
      v_result := public.admin_backfill_org_for_user(r.id);
      IF (v_result->>'ok')::boolean = true THEN
        IF (v_result->>'skipped')::boolean = true THEN
          v_skipped := v_skipped + 1;
        ELSE
          v_fixed := v_fixed + 1;
        END IF;
      ELSE
        v_errors := v_errors || jsonb_build_object(
          'user_id', r.id,
          'error', v_result->>'error'
        );
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors || jsonb_build_object(
        'user_id', r.id,
        'error', SQLERRM
      );
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'fixed', v_fixed,
    'skipped', v_skipped,
    'errors', v_errors,
    'error_count', jsonb_array_length(v_errors)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_backfill_all_no_org_accounts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_backfill_all_no_org_accounts() TO authenticated;

COMMENT ON FUNCTION public.admin_backfill_all_no_org_accounts() IS
  'Admin-only: iterates all agent/client profiles with no organization_members entry '
  'and creates the missing org + owner membership for each. '
  'Returns count of fixed/skipped/errored accounts. Idempotent.';
