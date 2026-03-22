-- B2B messaging is organization-to-organization. Agencies discover client *organizations* (not user profiles).
-- Run after migration_organizations_invitations_rls.sql, migration_resolve_b2b_chat_organization_ids.sql,
-- and migration_rpc_create_b2b_org_conversation.sql (optional but recommended).

-- ---------------------------------------------------------------------------
-- Directory: client organizations searchable by agency team members
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_client_organizations_for_agency_directory(
  p_agency_id uuid,
  p_search text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_caller uuid := auth.uid();
  rows_json jsonb;
  q text := coalesce(trim(p_search), '');
BEGIN
  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.organization_members m
    JOIN public.organizations o ON o.id = m.organization_id
    WHERE m.user_id = v_caller
      AND o.type = 'agency'
      AND o.agency_id = p_agency_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_allowed');
  END IF;

  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', x.id,
        'name', x.name,
        'organization_type', x.typ
      )
    ),
    '[]'::jsonb
  ) INTO rows_json
  FROM (
    SELECT o.id, o.name, o.type::text AS typ
    FROM public.organizations o
    WHERE o.type = 'client'
      AND (q = '' OR o.name ILIKE '%' || q || '%')
    ORDER BY o.name
    LIMIT 100
  ) x;

  RETURN jsonb_build_object('ok', true, 'rows', coalesce(rows_json, '[]'::jsonb));
END;
$$;

REVOKE ALL ON FUNCTION public.list_client_organizations_for_agency_directory(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_client_organizations_for_agency_directory(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.list_client_organizations_for_agency_directory IS
  'Agency org members only. Returns client organizations (id, name, organization_type) for B2B directory search.';

-- ---------------------------------------------------------------------------
-- Resolve org pair when agency targets a client *organization* (not a user id)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_b2b_org_pair_for_chat(
  p_agency_id uuid,
  p_client_organization_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_caller uuid := auth.uid();
  client_oid uuid;
  agency_oid uuid;
  ok_client boolean;
BEGIN
  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.organizations o
    WHERE o.id = p_client_organization_id AND o.type = 'client'
  ) INTO ok_client;

  IF NOT ok_client THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_client_org');
  END IF;

  IF NOT (
    EXISTS (
      SELECT 1
      FROM public.organization_members m
      JOIN public.organizations o ON o.id = m.organization_id
      WHERE m.user_id = v_caller
        AND o.type = 'agency'
        AND o.agency_id = p_agency_id
    )
    OR EXISTS (
      SELECT 1
      FROM public.organization_members m
      WHERE m.user_id = v_caller
        AND m.organization_id = p_client_organization_id
    )
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_allowed');
  END IF;

  client_oid := p_client_organization_id;

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

REVOKE ALL ON FUNCTION public.resolve_b2b_org_pair_for_chat(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_b2b_org_pair_for_chat(uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.resolve_b2b_org_pair_for_chat IS
  'Caller must be agency team member for p_agency_id OR member of the client organization. Returns both org UUIDs for B2B chat.';
