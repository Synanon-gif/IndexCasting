-- request_account_deletion reads profiles + organization_members under SECURITY DEFINER.
-- SET row_security TO off avoids PG15+ RLS re-evaluation / empty reads inside the function body.
-- All data access remains scoped to auth.uid().

CREATE OR REPLACE FUNCTION public.request_account_deletion()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  r text;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN false;
  END IF;

  SELECT p.role::text INTO r FROM public.profiles p WHERE p.id = auth.uid();
  IF NOT FOUND OR r IS NULL THEN
    RETURN false;
  END IF;

  IF r = 'agent' THEN
    IF EXISTS (
      SELECT 1
      FROM public.organization_members m
      JOIN public.organizations o ON o.id = m.organization_id AND o.type = 'agency'
      WHERE m.user_id = auth.uid()
    ) THEN
      IF NOT EXISTS (
        SELECT 1
        FROM public.organization_members m
        JOIN public.organizations o ON o.id = m.organization_id AND o.type = 'agency'
        WHERE m.user_id = auth.uid() AND m.role::text = 'owner'
      ) THEN
        RAISE EXCEPTION 'only_organization_owner_can_delete_account';
      END IF;
    END IF;
  ELSIF r = 'client' THEN
    IF EXISTS (
      SELECT 1
      FROM public.organization_members m
      JOIN public.organizations o ON o.id = m.organization_id AND o.type = 'client'
      WHERE m.user_id = auth.uid()
    ) THEN
      IF NOT EXISTS (
        SELECT 1
        FROM public.organization_members m
        JOIN public.organizations o ON o.id = m.organization_id AND o.type = 'client'
        WHERE m.user_id = auth.uid() AND m.role::text = 'owner'
      ) THEN
        RAISE EXCEPTION 'only_organization_owner_can_delete_account';
      END IF;
    END IF;
  END IF;

  UPDATE public.profiles
  SET deletion_requested_at = now(), updated_at = now()
  WHERE id = auth.uid();
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.request_account_deletion() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_account_deletion() TO authenticated;

COMMENT ON FUNCTION public.request_account_deletion() IS
  'Soft-delete request: sets profiles.deletion_requested_at. '
  'For agent/client: if the user has any org membership of that org type, they must be owner; '
  'if they have no such memberships (e.g. after dissolve_organization), deletion is allowed. '
  'Uses row_security=off; all reads/writes scoped to auth.uid().';
