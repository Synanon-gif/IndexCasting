-- F-08 Security fix: Application photos storage policy was too broad.
-- Previously ANY authenticated user (including clients, models) could read
-- model-applications/* objects. Now restricted to agency org members + bookers,
-- matching the product intent ("global recruiting pool for agencies").
--
-- Uses a SECDEF helper to avoid direct RLS-table joins in storage policy.

CREATE OR REPLACE FUNCTION public.caller_is_any_agency_member()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_members om
    JOIN public.organizations o ON o.id = om.organization_id
    WHERE om.user_id = auth.uid()
      AND o.type = 'agency'
  )
  OR EXISTS (
    SELECT 1
    FROM public.bookers b
    WHERE b.user_id = auth.uid()
  )
  OR public.is_current_user_admin();
$$;

REVOKE ALL ON FUNCTION public.caller_is_any_agency_member() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.caller_is_any_agency_member() TO authenticated;

-- Replace the broad policy with an agency-scoped one
DROP POLICY IF EXISTS "documentspictures_application_photos_read" ON storage.objects;

CREATE POLICY "documentspictures_application_photos_read"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'documentspictures'
    AND (storage.foldername(name))[1] = 'model-applications'
    AND public.caller_is_any_agency_member()
  );
