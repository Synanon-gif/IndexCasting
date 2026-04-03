-- =============================================================================
-- Fix client_project_models INSERT: require model to belong to a connected agency.
--
-- Security finding (Attack Simulation 2026-04, HOCH):
--   addModelToProject(projectId, modelId) inserts without verifying that the
--   model's agency has any connection to the inserting client organization.
--   A client who learns any model UUID (from an expired guest-link, a chat,
--   etc.) can add that model to their internal project even without a live
--   connection to the owning agency.
--
-- Fix:
--   1. Create a SECURITY DEFINER RPC add_model_to_project(p_project_id, p_model_id)
--      that validates:
--        a. The project belongs to the caller's organization.
--        b. An active client_agency_connections row exists between the caller
--           (or their org) and the model's agency.
--      Only then does it insert the row.
--   2. The TypeScript service layer calls this RPC instead of a direct table insert.
--   3. The direct INSERT RLS policy is tightened for defence-in-depth.
--
-- Table: public.client_agency_connections
--   client_id             UUID  (legacy: auth.users.id of the client user)
--   agency_id             UUID  (references public.agencies.id)
--   from_organization_id  UUID  (org that initiated — typically client org)
--   to_organization_id    UUID  (org that received — typically agency org)
--   status                connection_status
--
-- Idempotent: CREATE OR REPLACE + DROP/CREATE POLICY.
-- =============================================================================

-- ─── 1. RPC: add_model_to_project ─────────────────────────────────────────────

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
  -- Resolve the caller's client organization
  SELECT om.organization_id INTO v_caller_org_id
  FROM public.organization_members om
  JOIN public.organizations        org ON org.id = om.organization_id
                                      AND org.type = 'client'
  WHERE om.user_id = auth.uid()
  LIMIT 1;

  IF v_caller_org_id IS NULL THEN
    RAISE EXCEPTION 'add_model_to_project: caller has no client organization';
  END IF;

  -- Verify the project belongs to the caller's organization
  SELECT organization_id INTO v_project_org_id
  FROM public.client_projects
  WHERE id = p_project_id;

  IF v_project_org_id IS DISTINCT FROM v_caller_org_id THEN
    RAISE EXCEPTION 'add_model_to_project: project does not belong to caller organization';
  END IF;

  -- Resolve the model's agency
  SELECT agency_id INTO v_model_agency_id
  FROM public.models
  WHERE id = p_model_id;

  IF v_model_agency_id IS NULL THEN
    RAISE EXCEPTION 'add_model_to_project: model has no agency or does not exist';
  END IF;

  -- Check active connection between the caller's org and the model's agency.
  --
  -- We support two patterns:
  --   a) Org-to-org (modern): from_organization_id = caller's client org
  --      AND agency_id = model's agency
  --   b) User-to-agency (legacy): client_id = auth.uid()
  --      AND agency_id = model's agency
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

  -- Insert (idempotent — ignore duplicate)
  INSERT INTO public.client_project_models (project_id, model_id)
  VALUES (p_project_id, p_model_id)
  ON CONFLICT DO NOTHING;

  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.add_model_to_project(UUID, UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.add_model_to_project(UUID, UUID) TO authenticated;

-- ─── 2. Tighten direct INSERT RLS policy (defence-in-depth) ──────────────────

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
    -- An active connection must exist between the caller and the model's agency
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

-- ─── Verification ─────────────────────────────────────────────────────────────
-- SELECT routine_name FROM information_schema.routines
-- WHERE routine_schema = 'public' AND routine_name = 'add_model_to_project';
--
-- SELECT policyname, cmd FROM pg_policies
-- WHERE schemaname = 'public' AND tablename = 'client_project_models';
