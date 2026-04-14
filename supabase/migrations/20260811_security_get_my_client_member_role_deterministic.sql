-- F-07 Security fix: get_my_client_member_role was previously only in root-SQL
-- with LIMIT 1 without ORDER BY — non-deterministic for multi-org clients.
-- Now in migrations/ with ORDER BY created_at ASC (oldest membership wins,
-- consistent with get_my_org_context and paywall resolution).
-- Also adds SET row_security TO off (reads organization_members which has RLS).

DROP FUNCTION IF EXISTS public.get_my_client_member_role();

CREATE OR REPLACE FUNCTION public.get_my_client_member_role()
RETURNS TABLE(member_role text, organization_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
SET row_security TO off
AS $function$
  SELECT m.role::text, m.organization_id
  FROM public.organization_members m
  JOIN public.organizations o ON o.id = m.organization_id
  WHERE m.user_id = auth.uid()
    AND o.type = 'client'
  ORDER BY m.created_at ASC
  LIMIT 1;
$function$;

REVOKE ALL ON FUNCTION public.get_my_client_member_role() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_client_member_role() TO authenticated;
