-- =============================================================================
-- Extend get_my_org_context() to include agency_id
--
-- Problem: The function returns organization_id, org_type, org_member_role but
-- NOT organizations.agency_id. This forces AgencyControllerView to use a
-- fragile email-match against the agencies table to determine currentAgencyId,
-- instead of using the canonical org membership as the source of truth.
--
-- Fix: Add agency_id to the return type so the frontend can derive
-- currentAgencyId directly from org membership (organizations.agency_id),
-- eliminating the email-match lookup and the broken agencies[0] fallback.
--
-- Also adds SET row_security TO off (required per admin-security.mdc for
-- SECURITY DEFINER functions that read RLS-protected tables, to prevent
-- latent recursion in PG15+).
--
-- Idempotent — safe to run multiple times.
-- =============================================================================

DROP FUNCTION IF EXISTS public.get_my_org_context();

CREATE OR REPLACE FUNCTION public.get_my_org_context()
RETURNS TABLE(
  organization_id uuid,
  org_type        organization_type,
  org_member_role org_member_role,
  agency_id       uuid
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
  SELECT
    m.organization_id,
    o.type          AS org_type,
    m.role          AS org_member_role,
    o.agency_id     AS agency_id
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
  'Includes agency_id so the frontend can resolve currentAgencyId directly '
  'from org membership instead of fragile email-matching against agencies table. '
  'ORDER BY created_at ASC ensures deterministic selection (oldest membership). '
  'SET row_security TO off prevents PG15+ latent recursion in SECURITY DEFINER context.';
