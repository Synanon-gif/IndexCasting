-- =============================================================================
-- 20260549: option_requests client_organization_id backfill + can_access_platform GRANT
--
-- 1) Legacy rows: organization_id points at client org but client_organization_id
--    was NULL → RLS visibility via client_organization_id branch failed for some
--    users. Backfill only where organizations.type = 'client'.
-- 2) Idempotent: ensure authenticated role can EXECUTE can_access_platform (42501 drift).
-- =============================================================================

UPDATE public.option_requests oq
SET client_organization_id = oq.organization_id
WHERE oq.client_organization_id IS NULL
  AND oq.organization_id IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM public.organizations o
    WHERE o.id = oq.organization_id
      AND o.type = 'client'::public.organization_type
  );

-- Defensive: re-apply execute grant (no-op if already granted)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'can_access_platform'
      AND p.pronargs = 0
  ) THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.can_access_platform() TO authenticated';
  END IF;
END;
$$;
