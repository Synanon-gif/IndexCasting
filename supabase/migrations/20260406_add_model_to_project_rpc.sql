-- =============================================================================
-- add_model_to_project RPC — proper migration (2026-04-06)
--
-- Previously only existed in supabase/migration_project_models_agency_scope_2026_04.sql
-- (root file, NOT auto-deployed by Supabase CLI). This migration makes it part of
-- the tracked migration history so fresh instances are reproducible.
--
-- Security: SECURITY DEFINER RPC validates:
--   1. Caller has a client organization (organization_members + organizations.type='client')
--   2. Project belongs to caller's client organization
--   3. Model's agency has an active connection with caller's client org
-- Only then does it insert into client_project_models (idempotent: ON CONFLICT DO NOTHING).
--
-- NOTE: LIMIT 1 is used for caller org resolution. In the rare case a user belongs to
-- multiple client orgs, the wrong org may be selected, causing a project-ownership error
-- (not a security leak — user still can't access projects they don't own). Acceptable
-- until explicit org-selection is added to the UI for multi-org users.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.add_model_to_project(
  p_project_id UUID,
  p_model_id   UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_org_id   UUID;
  v_project_org_id  UUID;
  v_model_agency_id UUID;
  v_connected        BOOLEAN := false;
BEGIN
  -- GUARD 1: Resolve the caller's client organization
  -- LIMIT 1: intentional — see note above; sub-resource checks follow to prevent misuse
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
  -- Supports both org-to-org (modern) and user-to-agency (legacy) connection patterns.
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

  -- Insert (idempotent — ON CONFLICT DO NOTHING on PRIMARY KEY (project_id, model_id))
  INSERT INTO public.client_project_models (project_id, model_id)
  VALUES (p_project_id, p_model_id)
  ON CONFLICT DO NOTHING;

  RETURN TRUE;
END;
$$;

REVOKE ALL   ON FUNCTION public.add_model_to_project(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.add_model_to_project(UUID, UUID) TO authenticated;

-- Defence-in-depth: tighten direct INSERT RLS policy on client_project_models
DROP POLICY IF EXISTS "client_project_models_org_member"    ON public.client_project_models;
DROP POLICY IF EXISTS "client_project_models_agency_scoped" ON public.client_project_models;

CREATE POLICY "client_project_models_agency_scoped"
  ON public.client_project_models
  FOR INSERT
  TO authenticated
  WITH CHECK (
    -- The inserting user must be a member of the project's organization
    EXISTS (
      SELECT 1
      FROM public.client_projects     cp
      JOIN public.organization_members om ON om.organization_id = cp.organization_id
      WHERE cp.id      = client_project_models.project_id
        AND om.user_id = auth.uid()
    )
    AND
    -- An active connection must exist between the caller's org and the model's agency
    EXISTS (
      SELECT 1
      FROM public.models                   m
      JOIN public.client_agency_connections c ON c.agency_id = m.agency_id
      WHERE m.id       = client_project_models.model_id
        AND c.status   = 'accepted'
        AND (
          c.from_organization_id = (
            SELECT cp2.organization_id
            FROM public.client_projects cp2
            WHERE cp2.id = client_project_models.project_id
          )
          OR c.client_id = auth.uid()
        )
    )
  );
