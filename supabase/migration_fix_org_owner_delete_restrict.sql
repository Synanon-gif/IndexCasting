-- =============================================================================
-- MED-5: organizations.owner_id – ON DELETE CASCADE → RESTRICT
--
-- Problem: owner_id hat ON DELETE CASCADE, was die gesamte Organisation
--   (inkl. aller Mitglieder und Daten) löscht, sobald der Owner seinen Account
--   hart löscht. Employees verlieren ohne Vorwarnung ihren gesamten Workspace.
--
-- Fix:
--   1. FK-Constraint auf ON DELETE RESTRICT ändern. Owner-Account kann nur
--      gelöscht werden, nachdem die Org aufgelöst oder übertragen wurde.
--   2. transfer_org_ownership(target_user_id) RPC: Owner übergibt Rolle an
--      ein bestehendes Mitglied. Nur der aktuelle Owner kann dies aufrufen.
--   3. dissolve_organization() RPC: Owner löst die Org vollständig auf
--      (alle Mitglieder werden entfernt, Org wird gelöscht). Nur Owner.
--
-- ACHTUNG: Vor dieser Migration sicherstellen, dass keine Auth-User-Deletions
--   mit noch vorhandenen Org-Owner-Rows ausstehen (Verifikationsquery unten).
-- =============================================================================

-- ─── Verifikation vor Migration ───────────────────────────────────────────────
-- SELECT o.id, o.name FROM organizations o
-- LEFT JOIN auth.users u ON u.id = o.owner_id
-- WHERE u.id IS NULL;
-- → Muss 0 Rows zurückgeben, bevor diese Migration läuft.

-- ─── 1. FK-Constraint ändern ─────────────────────────────────────────────────
ALTER TABLE public.organizations
  DROP CONSTRAINT IF EXISTS organizations_owner_id_fkey;

ALTER TABLE public.organizations
  ADD CONSTRAINT organizations_owner_id_fkey
  FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE RESTRICT;

-- ─── 2. transfer_org_ownership ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.transfer_org_ownership(
  p_organization_id UUID,
  p_new_owner_id    UUID
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_owner_id uuid;
  target_member_role public.org_member_role;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  -- Verify caller is the current owner
  SELECT owner_id INTO current_owner_id
  FROM public.organizations
  WHERE id = p_organization_id;

  IF current_owner_id IS DISTINCT FROM auth.uid() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden_not_owner');
  END IF;

  -- Verify target user is already a member of this org
  SELECT role INTO target_member_role
  FROM public.organization_members
  WHERE organization_id = p_organization_id
    AND user_id = p_new_owner_id;

  IF target_member_role IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'target_not_member');
  END IF;

  -- Transfer ownership:
  -- a) Demote current owner to booker (agency) or employee (client)
  UPDATE public.organization_members
  SET role = CASE
    WHEN (SELECT type FROM public.organizations WHERE id = p_organization_id) = 'agency'
      THEN 'booker'::public.org_member_role
      ELSE 'employee'::public.org_member_role
    END
  WHERE organization_id = p_organization_id
    AND user_id = auth.uid();

  -- b) Promote new owner (update existing member row)
  UPDATE public.organization_members
  SET role = 'owner'::public.org_member_role
  WHERE organization_id = p_organization_id
    AND user_id = p_new_owner_id;

  -- c) Update organizations.owner_id
  UPDATE public.organizations
  SET owner_id = p_new_owner_id
  WHERE id = p_organization_id;

  RETURN jsonb_build_object('ok', true, 'new_owner_id', p_new_owner_id);
END;
$$;

REVOKE ALL ON FUNCTION public.transfer_org_ownership(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.transfer_org_ownership(UUID, UUID) TO authenticated;

COMMENT ON FUNCTION public.transfer_org_ownership(uuid, uuid) IS
  'Transfers org ownership to an existing member. '
  'Caller must be the current owner. '
  'Current owner is demoted to booker/employee; new owner is promoted. '
  'Required before the former owner can delete their account.';

-- ─── 3. dissolve_organization ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.dissolve_organization(p_organization_id UUID)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

  -- Remove all members first (org cascade would also do this, but be explicit)
  DELETE FROM public.organization_members WHERE organization_id = p_organization_id;

  -- Remove pending invitations
  DELETE FROM public.invitations WHERE organization_id = p_organization_id;

  -- Delete the organization (FK RESTRICT on owner_id is now safe since
  -- the auth.users row isn't being deleted here — org row itself is deleted)
  DELETE FROM public.organizations WHERE id = p_organization_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.dissolve_organization(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dissolve_organization(UUID) TO authenticated;

COMMENT ON FUNCTION public.dissolve_organization(uuid) IS
  'Owner dissolves their organization: removes all members, invitations, and the org row. '
  'After this, the owner may delete their auth account without FK constraint violations.';
