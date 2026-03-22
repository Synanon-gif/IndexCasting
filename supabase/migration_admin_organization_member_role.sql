-- Admin: list and update organization_members.role (Owner vs Booker/Employee).
-- profiles.role stays model|agent|client; B2B "Owner" is organization_members.role = owner.
-- Run after migration_organizations_invitations_rls.sql and migration_org_single_owner_invariant.sql.

CREATE OR REPLACE FUNCTION public.admin_list_org_memberships(p_target_user_id UUID)
RETURNS TABLE(organization_id UUID, org_name TEXT, org_type TEXT, member_role public.org_member_role)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN QUERY
  SELECT o.id, o.name, o.type::text, m.role
  FROM public.organization_members m
  JOIN public.organizations o ON o.id = m.organization_id
  WHERE m.user_id = p_target_user_id
  ORDER BY o.name;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_org_memberships(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_org_memberships(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_organization_member_role(
  p_target_user_id UUID,
  p_organization_id UUID,
  p_role public.org_member_role
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_is_admin BOOLEAN;
  org_kind public.organization_type;
  old_owner_id UUID;
  demoted_role public.org_member_role;
BEGIN
  SELECT is_admin INTO caller_is_admin FROM public.profiles WHERE id = auth.uid();
  IF NOT COALESCE(caller_is_admin, false) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

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
$$;

REVOKE ALL ON FUNCTION public.admin_set_organization_member_role(UUID, UUID, public.org_member_role) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_organization_member_role(UUID, UUID, public.org_member_role) TO authenticated;

COMMENT ON FUNCTION public.admin_set_organization_member_role(UUID, UUID, public.org_member_role) IS
  'Admin only. Sets organization_members.role; promoting to owner demotes the previous owner to booker (agency) or employee (client).';
