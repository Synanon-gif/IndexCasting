-- =============================================================================
-- Audit 2026-04-07: add_model_to_project — SET row_security TO off
--
-- This RPC reads organization_members, organizations, client_projects, models,
-- and client_agency_connections. Under PostgreSQL 15+, RLS still applies inside
-- SECURITY DEFINER unless row_security is disabled. Without it, legitimate
-- client flows can see empty/failed reads despite guards.
--
-- Internal guards (auth.uid(), org match, connection check) remain unchanged
-- per Rule 21 — row_security=off is not a substitute for caller scope checks.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.add_model_to_project(
  p_project_id UUID,
  p_model_id   UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_caller_org_id   UUID;
  v_project_org_id  UUID;
  v_model_agency_id UUID;
  v_connected        BOOLEAN := false;
BEGIN
  -- GUARD 1: Resolve the caller's client organization
  -- LIMIT 1: intentional — see note in 20260406_add_model_to_project_rpc.sql
  SELECT om.organization_id INTO v_caller_org_id
  FROM public.organization_members om
  JOIN public.organizations        org ON org.id = om.organization_id
                                      AND org.type = 'client'
  WHERE om.user_id = auth.uid()
  LIMIT 1;

  IF v_caller_org_id IS NULL THEN
    RAISE EXCEPTION 'add_model_to_project: caller has no client organization';
  END IF;

  -- GUARD 2: Verify the project belongs to the caller's organization
  SELECT organization_id INTO v_project_org_id
  FROM public.client_projects
  WHERE id = p_project_id;

  IF v_project_org_id IS DISTINCT FROM v_caller_org_id THEN
    RAISE EXCEPTION 'add_model_to_project: project does not belong to caller organization';
  END IF;

  -- GUARD 3: Resolve the model's agency
  SELECT agency_id INTO v_model_agency_id
  FROM public.models
  WHERE id = p_model_id;

  IF v_model_agency_id IS NULL THEN
    RAISE EXCEPTION 'add_model_to_project: model has no agency or does not exist';
  END IF;

  -- GUARD 4: Check active connection between the caller's org and the model's agency.
  SELECT EXISTS (
    SELECT 1
    FROM public.client_agency_connections c
    WHERE c.agency_id = v_model_agency_id
      AND c.status    = 'accepted'
      AND (
        c.from_organization_id = v_caller_org_id
        OR
        c.client_id = auth.uid()
      )
  ) INTO v_connected;

  IF NOT v_connected THEN
    RAISE EXCEPTION 'add_model_to_project: no active connection to the model agency (agency_id=%)', v_model_agency_id;
  END IF;

  INSERT INTO public.client_project_models (project_id, model_id)
  VALUES (p_project_id, p_model_id)
  ON CONFLICT DO NOTHING;

  RETURN TRUE;
END;
$$;

REVOKE ALL   ON FUNCTION public.add_model_to_project(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.add_model_to_project(UUID, UUID) TO authenticated;
