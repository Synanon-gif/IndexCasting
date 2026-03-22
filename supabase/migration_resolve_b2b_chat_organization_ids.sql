-- B2B "Start chat" needs client_org_id + agency_org_id across org boundaries.
-- Direct SELECT on organizations / organization_members fails RLS when the caller is not a member
-- of the other party's org. This RPC validates the caller and resolves both IDs server-side.
--
-- Run after migration_organizations_invitations_rls.sql and migration_connection_messenger_org_scope.sql.

CREATE OR REPLACE FUNCTION public.resolve_b2b_chat_organization_ids(
  p_client_user_id uuid,
  p_agency_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  client_oid uuid;
  agency_oid uuid;
  caller uuid := auth.uid();
  is_agent_member boolean;
  is_client_self boolean;
BEGIN
  IF caller IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  is_client_self := (caller = p_client_user_id);

  SELECT EXISTS (
    SELECT 1
    FROM public.organization_members m
    JOIN public.organizations o ON o.id = m.organization_id
    WHERE m.user_id = caller
      AND o.type = 'agency'
      AND o.agency_id = p_agency_id
  ) INTO is_agent_member;

  IF NOT is_client_self AND NOT is_agent_member THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_allowed');
  END IF;

  IF is_client_self THEN
    IF (SELECT role FROM public.profiles WHERE id = caller) IS DISTINCT FROM 'client' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'caller_not_client');
    END IF;

    SELECT o.id INTO client_oid
    FROM public.organization_members m
    JOIN public.organizations o ON o.id = m.organization_id
    WHERE m.user_id = p_client_user_id AND o.type = 'client'
    LIMIT 1;

    IF client_oid IS NULL THEN
      PERFORM public.ensure_client_organization();
      SELECT o.id INTO client_oid
      FROM public.organization_members m
      JOIN public.organizations o ON o.id = m.organization_id
      WHERE m.user_id = p_client_user_id AND o.type = 'client'
      LIMIT 1;
    END IF;
  ELSE
    SELECT o.id INTO client_oid
    FROM public.organization_members m
    JOIN public.organizations o ON o.id = m.organization_id
    WHERE m.user_id = p_client_user_id AND o.type = 'client'
    LIMIT 1;
  END IF;

  IF client_oid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'client_org_missing');
  END IF;

  SELECT o.id INTO agency_oid
  FROM public.organizations o
  WHERE o.agency_id = p_agency_id AND o.type = 'agency'
  LIMIT 1;

  IF agency_oid IS NULL THEN
    BEGIN
      PERFORM public.ensure_agency_organization(p_agency_id);
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
    SELECT o.id INTO agency_oid
    FROM public.organizations o
    WHERE o.agency_id = p_agency_id AND o.type = 'agency'
    LIMIT 1;
  END IF;

  IF agency_oid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'agency_org_missing');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'client_org_id', client_oid,
    'agency_org_id', agency_oid
  );
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_b2b_chat_organization_ids(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_b2b_chat_organization_ids(UUID, UUID) TO authenticated;

COMMENT ON FUNCTION public.resolve_b2b_chat_organization_ids(UUID, UUID) IS
  'Caller must be the client user or a member of the given agency org. Returns client + agency organization UUIDs for B2B chat.';
