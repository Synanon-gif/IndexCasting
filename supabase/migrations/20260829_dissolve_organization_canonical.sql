-- Canonical dissolve_organization in migrations/ (historically in root migration_fix_org_owner_delete_restrict.sql).
-- Same semantics; adds SET row_security TO off for PG15+ consistency with other SECDEF org RPCs.

CREATE OR REPLACE FUNCTION public.dissolve_organization(p_organization_id UUID)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  current_owner_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  SELECT owner_id INTO current_owner_id
  FROM public.organizations WHERE id = p_organization_id;

  IF current_owner_id IS DISTINCT FROM auth.uid() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden_not_owner');
  END IF;

  DELETE FROM public.organization_members WHERE organization_id = p_organization_id;
  DELETE FROM public.invitations WHERE organization_id = p_organization_id;
  DELETE FROM public.organizations WHERE id = p_organization_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.dissolve_organization(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dissolve_organization(UUID) TO authenticated;

COMMENT ON FUNCTION public.dissolve_organization(uuid) IS
  'Owner dissolves their organization: removes all members, invitations, and the org row. '
  'After this, the owner may delete their auth account without FK constraint violations.';
