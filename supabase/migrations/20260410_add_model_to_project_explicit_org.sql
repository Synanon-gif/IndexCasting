-- =============================================================================
-- add_model_to_project — optional explicit client organization_id (2026-04-10)
--
-- When p_organization_id is provided, caller org is that UUID iff the user is
-- a member of a client-type organization with that id (fail-closed).
-- When NULL, preserves legacy LIMIT 1 resolution for single-org / old clients.
-- =============================================================================

DROP FUNCTION IF EXISTS public.add_model_to_project(uuid, uuid);

CREATE OR REPLACE FUNCTION public.add_model_to_project(
  p_project_id UUID,
  p_model_id UUID,
  p_organization_id UUID DEFAULT NULL
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
  v_connected       BOOLEAN := false;
  v_is_member       BOOLEAN := false;
BEGIN
  IF p_organization_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.organization_members om
      JOIN public.organizations org ON org.id = om.organization_id
                                   AND org.type = 'client'
      WHERE om.user_id = auth.uid()
        AND om.organization_id = p_organization_id
    ) INTO v_is_member;

    IF NOT v_is_member THEN
      RAISE EXCEPTION 'add_model_to_project: caller is not a member of the specified client organization';
    END IF;

    v_caller_org_id := p_organization_id;
  ELSE
    SELECT om.organization_id INTO v_caller_org_id
    FROM public.organization_members om
    JOIN public.organizations org ON org.id = om.organization_id
                                 AND org.type = 'client'
    WHERE om.user_id = auth.uid()
    LIMIT 1;
  END IF;

  IF v_caller_org_id IS NULL THEN
    RAISE EXCEPTION 'add_model_to_project: caller has no client organization';
  END IF;

  SELECT organization_id INTO v_project_org_id
  FROM public.client_projects
  WHERE id = p_project_id;

  IF v_project_org_id IS DISTINCT FROM v_caller_org_id THEN
    RAISE EXCEPTION 'add_model_to_project: project does not belong to caller organization';
  END IF;

  SELECT agency_id INTO v_model_agency_id
  FROM public.models
  WHERE id = p_model_id;

  IF v_model_agency_id IS NULL THEN
    RAISE EXCEPTION 'add_model_to_project: model has no agency or does not exist';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.client_agency_connections c
    WHERE c.agency_id = v_model_agency_id
      AND c.status = 'accepted'
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

REVOKE ALL   ON FUNCTION public.add_model_to_project(UUID, UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.add_model_to_project(UUID, UUID, UUID) TO authenticated;

COMMENT ON FUNCTION public.add_model_to_project(UUID, UUID, UUID) IS
  'Adds a model to a client project. Pass p_organization_id when known (multi-org-safe); NULL uses legacy LIMIT 1 org pick.';
