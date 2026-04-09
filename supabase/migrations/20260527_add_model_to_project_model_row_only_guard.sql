-- =============================================================================
-- add_model_to_project — model row existence only (2026-05-27)
--
-- Product: If a model appears in Client Discover, add-to-project must succeed
-- without requiring models.agency_id or model_agency_territories alignment with
-- p_country_iso (those could drift from discovery RPC resolution).
-- Guards: auth, client org + project org match, FK target model row exists.
-- p_country_iso retained for API compatibility with callers; unused here.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.add_model_to_project(
  p_project_id UUID,
  p_model_id UUID,
  p_organization_id UUID DEFAULT NULL,
  p_country_iso TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_caller_org_id UUID;
  v_project_org_id UUID;
  v_is_member     BOOLEAN := false;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'add_model_to_project: not_authenticated';
  END IF;

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
    ORDER BY om.created_at ASC
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

  IF NOT EXISTS (SELECT 1 FROM public.models WHERE id = p_model_id) THEN
    RAISE EXCEPTION 'add_model_to_project: model does not exist';
  END IF;

  INSERT INTO public.client_project_models (project_id, model_id)
  VALUES (p_project_id, p_model_id)
  ON CONFLICT DO NOTHING;

  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.add_model_to_project(UUID, UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.add_model_to_project(UUID, UUID, UUID, TEXT) TO authenticated;

COMMENT ON FUNCTION public.add_model_to_project(UUID, UUID, UUID, TEXT) IS
  'Adds a model to a client project. Requires client org + project org match and models row exists. Optional p_organization_id when known. p_country_iso unused (signature compatibility). No client_agency_connections.';
