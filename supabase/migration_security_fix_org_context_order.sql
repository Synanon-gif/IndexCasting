-- =============================================================================
-- HIGH-04: Fix non-deterministic org context lookup in get_my_org_context()
--
-- Problem: get_my_org_context() uses LIMIT 1 without ORDER BY.
-- For users with multiple organization_members rows (legacy data before the
-- single-org enforcement in Phase 21), the selected org is non-deterministic —
-- PostgreSQL may return any row. This can cause users to land in the wrong
-- org context, potentially accessing incorrect data or billing state.
--
-- Fix: Add ORDER BY created_at ASC to match the ordering used in:
--   - create-checkout-session Edge Function (order('created_at', ascending: true))
--   - can_access_platform() (ORDER BY om.created_at ASC in migration_security_audit_2026_04.sql)
--
-- This ensures the EARLIEST membership is always chosen as the canonical org,
-- consistent across all org-resolution code paths.
--
-- Idempotent — safe to run multiple times.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_my_org_context()
RETURNS TABLE(
  organization_id uuid,
  org_type        organization_type,
  org_member_role org_member_role
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    m.organization_id,
    o.type          AS org_type,
    m.role          AS org_member_role
  FROM public.organization_members m
  JOIN public.organizations o ON o.id = m.organization_id
  WHERE m.user_id = auth.uid()
  ORDER BY m.created_at ASC
  LIMIT 1;
$$;

REVOKE ALL    ON FUNCTION public.get_my_org_context() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_org_context() TO authenticated;

COMMENT ON FUNCTION public.get_my_org_context() IS
  'Returns the canonical org context for the calling user. '
  'ORDER BY created_at ASC ensures deterministic selection (oldest membership). '
  'HIGH-04 fix: added ORDER BY to eliminate non-deterministic LIMIT 1 behavior.';

-- ─── Verification ─────────────────────────────────────────────────────────────
-- SELECT routine_name, routine_definition
-- FROM information_schema.routines
-- WHERE routine_schema = 'public' AND routine_name = 'get_my_org_context';
