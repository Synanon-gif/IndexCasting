-- =============================================================================
-- admin_convert_org_type v2: Fixes trigger issue from v1.
--
-- v1 used ALTER TABLE DISABLE TRIGGER which requires elevated privileges
-- not available in Supabase PostgREST context. v2 avoids this by
-- changing organizations.type FIRST — the trigger on organization_members
-- only fires on org_members changes, not on organizations changes.
-- After the type is updated, the role changes are valid for the new type.
--
-- Order for client→agency:
--   1. UPDATE organizations SET type = 'agency'
--   2. UPDATE org_members SET role = 'booker' WHERE role = 'employee'
--      → trigger sees: org.type='agency', new role='booker' → valid
--
-- Order for agency→client:
--   1. UPDATE organizations SET type = 'client'
--   2. UPDATE org_members SET role = 'employee' WHERE role = 'booker'
--      → trigger sees: org.type='client', new role='employee' → valid
-- =============================================================================

CREATE OR REPLACE FUNCTION public.admin_convert_org_type(
  p_org_id uuid,
  p_new_type text  -- 'agency' or 'client'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_current_type public.organization_type;
  v_org_name     text;
  v_owner_id     uuid;
  v_owner_email  text;
  v_agency_id    uuid;
  v_new_code     text;
  v_member       record;
  v_converted    int := 0;
BEGIN
  PERFORM public.assert_is_admin();

  IF p_new_type NOT IN ('agency', 'client') THEN
    RAISE EXCEPTION 'invalid_type: must be agency or client, got %', p_new_type;
  END IF;

  SELECT type, name, owner_id, agency_id
  INTO v_current_type, v_org_name, v_owner_id, v_agency_id
  FROM public.organizations
  WHERE id = p_org_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'org_not_found: %', p_org_id;
  END IF;

  IF v_current_type::text = p_new_type THEN
    RETURN jsonb_build_object(
      'ok', true,
      'skipped', true,
      'reason', 'already_' || p_new_type
    );
  END IF;

  -- ── Step 1: Update organization type FIRST ───────────────────────────
  -- The role-validation trigger only fires on organization_members changes,
  -- NOT on organizations changes. So this is safe — existing members
  -- temporarily have stale roles but no trigger validates them here.
  UPDATE public.organizations
  SET type = p_new_type::public.organization_type
  WHERE id = p_org_id;

  -- ── Step 2: Convert member roles ─────────────────────────────────────
  -- Now the trigger sees the new org type and validates against it:
  -- agency: owner/booker valid. client: owner/employee valid.
  IF p_new_type = 'agency' THEN
    UPDATE public.organization_members
    SET role = 'booker'::public.org_member_role
    WHERE organization_id = p_org_id AND role = 'employee';
    GET DIAGNOSTICS v_converted = ROW_COUNT;
  ELSE
    UPDATE public.organization_members
    SET role = 'employee'::public.org_member_role
    WHERE organization_id = p_org_id AND role = 'booker';
    GET DIAGNOSTICS v_converted = ROW_COUNT;
  END IF;

  -- ── Step 3: Handle agency_id / agencies row ──────────────────────────
  IF p_new_type = 'agency' THEN
    IF v_agency_id IS NULL THEN
      SELECT email INTO v_owner_email
      FROM auth.users WHERE id = v_owner_id;

      SELECT a.id INTO v_agency_id
      FROM public.agencies a
      WHERE lower(trim(a.email)) = lower(trim(COALESCE(v_owner_email, '')))
      LIMIT 1;

      IF v_agency_id IS NULL THEN
        v_new_code := 'a' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 15);
        INSERT INTO public.agencies (name, email, code)
        VALUES (v_org_name, COALESCE(v_owner_email, ''), v_new_code)
        RETURNING id INTO v_agency_id;
      END IF;

      UPDATE public.organizations
      SET agency_id = v_agency_id
      WHERE id = p_org_id;
    END IF;
  ELSE
    UPDATE public.organizations
    SET agency_id = NULL
    WHERE id = p_org_id;
  END IF;

  -- ── Step 4: Update profiles.role for all members ─────────────────────
  FOR v_member IN
    SELECT user_id FROM public.organization_members
    WHERE organization_id = p_org_id
  LOOP
    IF p_new_type = 'agency' THEN
      UPDATE public.profiles
      SET role = 'agent'
      WHERE id = v_member.user_id AND role = 'client';
    ELSE
      UPDATE public.profiles
      SET role = 'client'
      WHERE id = v_member.user_id AND role = 'agent';
    END IF;
  END LOOP;

  -- ── Step 5: Audit log ────────────────────────────────────────────────
  INSERT INTO public.admin_logs (admin_id, action, details)
  VALUES (
    auth.uid(),
    'admin_convert_org_type',
    jsonb_build_object(
      'org_id',        p_org_id,
      'org_name',      v_org_name,
      'from_type',     v_current_type::text,
      'to_type',       p_new_type,
      'members_converted', v_converted,
      'agency_id',     v_agency_id
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'from_type', v_current_type::text,
    'to_type', p_new_type,
    'members_converted', v_converted,
    'agency_id', v_agency_id
  );
END;
$$;

REVOKE ALL    ON FUNCTION public.admin_convert_org_type(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_convert_org_type(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.admin_convert_org_type(uuid, text) IS
  'Admin-only: atomically converts an organization between client and agency types. '
  'Updates organizations.type, organization_members roles (employee<->booker), '
  'profiles.role for all members (client<->agent), and manages the agencies row. '
  'Changes org type FIRST so the role-validation trigger sees valid combinations.';
