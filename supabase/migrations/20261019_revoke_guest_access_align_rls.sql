-- 20261019_revoke_guest_access_align_rls.sql
--
-- Align public.revoke_guest_access membership guard with the RLS policies on
-- public.guest_links (agency_select_own_guest_links / guest_links_update_own_agency
-- / guest_links_delete_own_agency). The previous version only checked
-- organization_members → it raised permission_denied for two valid agency callers:
--   1. Agency owners that have only the owner_id link on organizations and no
--      explicit organization_members row.
--   2. Legacy bookers (still active in some orgs) registered in public.bookers
--      but not yet migrated into organization_members.
--
-- Result: agencies could not soft-delete their own guest packages from the UI
-- ("Delete" button silently failed). With the same three-branch guard the
-- function now succeeds for any caller who would also pass the RLS DELETE/UPDATE
-- policy on guest_links.
--
-- Idempotent. Single migration; not deployed via root supabase/*.sql.

CREATE OR REPLACE FUNCTION public.revoke_guest_access(p_link_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_uid  UUID := auth.uid();
  v_link public.guest_links%ROWTYPE;
  v_authorized BOOLEAN := false;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  SELECT gl.* INTO v_link FROM public.guest_links gl WHERE gl.id = p_link_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'guest_link_not_found'; END IF;

  -- Branch 1: caller is an org_member of an agency org for this agency_id
  IF EXISTS (
    SELECT 1
    FROM public.organizations o
    JOIN public.organization_members om ON om.organization_id = o.id
    WHERE o.agency_id = v_link.agency_id
      AND om.user_id = v_uid
      AND o.type = 'agency'::organization_type
  ) THEN
    v_authorized := true;
  END IF;

  -- Branch 2: caller is the owner of an agency org for this agency_id
  IF NOT v_authorized AND EXISTS (
    SELECT 1
    FROM public.organizations o
    WHERE o.agency_id = v_link.agency_id
      AND o.owner_id = v_uid
      AND o.type = 'agency'::organization_type
  ) THEN
    v_authorized := true;
  END IF;

  -- Branch 3: legacy bookers row matches caller for this agency
  IF NOT v_authorized AND EXISTS (
    SELECT 1
    FROM public.bookers b
    WHERE b.agency_id = v_link.agency_id
      AND b.user_id = v_uid
  ) THEN
    v_authorized := true;
  END IF;

  IF NOT v_authorized THEN
    RAISE EXCEPTION 'permission_denied';
  END IF;

  -- Idempotent soft-delete: never overwrite a previous deleted_at.
  UPDATE public.guest_links
  SET is_active = false,
      deleted_at = COALESCE(deleted_at, now())
  WHERE id = p_link_id;

  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.revoke_guest_access(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.revoke_guest_access(uuid) TO authenticated;
