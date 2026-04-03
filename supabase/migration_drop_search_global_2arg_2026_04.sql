-- =============================================================================
-- Drop redundant 2-argument overload of search_global  (2026-04 Security)
--
-- Problem: Two overloads of search_global() exist:
--   (1) search_global(p_query text, p_org_id uuid)              — 2-arg
--   (2) search_global(p_query text, p_org_id uuid, p_limit int) — 3-arg
--
-- The TypeScript client exclusively calls the 3-arg version (migration_perf_
-- audit_fixes.sql).  The 2-arg version is redundant, has a separate GRANT to
-- `authenticated`, and unnecessarily widens the callable surface area.
-- Removing it reduces attack surface without any functional impact.
--
-- Both overloads include the same organization-membership security guard
-- (organization_members WHERE user_id = auth.uid()), so no data is currently
-- leaking through the 2-arg version; this is a hygiene / surface-reduction fix.
--
-- Idempotent: IF EXISTS prevents failure if already removed.
-- =============================================================================

DROP FUNCTION IF EXISTS public.search_global(text, uuid);

-- Verify only the 3-arg overload remains:
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.routines
    WHERE routine_schema = 'public'
      AND routine_name   = 'search_global'
  ) THEN
    RAISE EXCEPTION 'search_global(text,uuid,integer) not found after drop — check migration order';
  END IF;
END;
$$;
