-- Restrict self-service account deletion for agency/client to organization owners only.
-- Models (and other roles) keep the previous behaviour: request deletion without org-owner check.
-- Run after migration_account_self_deletion.sql

CREATE OR REPLACE FUNCTION public.request_account_deletion()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
    IF NOT EXISTS (
      SELECT 1
      FROM public.organization_members m
      JOIN public.organizations o ON o.id = m.organization_id AND o.type = 'agency'
      WHERE m.user_id = auth.uid() AND m.role::text = 'owner'
    ) THEN
      RAISE EXCEPTION 'only_organization_owner_can_delete_account';
    END IF;
  ELSIF r = 'client' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.organization_members m
      JOIN public.organizations o ON o.id = m.organization_id AND o.type = 'client'
      WHERE m.user_id = auth.uid() AND m.role::text = 'owner'
    ) THEN
      RAISE EXCEPTION 'only_organization_owner_can_delete_account';
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
