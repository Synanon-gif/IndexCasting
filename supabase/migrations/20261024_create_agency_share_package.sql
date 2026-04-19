-- =============================================================================
-- 20261024_create_agency_share_package.sql
--
-- Agency-to-Agency Roster Share — sender RPC.
--
-- Creates a `guest_links` row with `purpose = 'agency_share'` for sending a
-- portfolio+polaroid (mixed) package from sender agency A to recipient agency B.
--
-- Authorization:
--   * Caller must be authenticated.
--   * Caller must be a member of `p_organization_id` (sender agency org).
--   * Every model in `p_model_ids` must currently have `models.agency_id` =
--     sender agency_id (v1 scope: only home-agency models can be shared).
--
-- Recipient resolution:
--   * `p_recipient_email` is matched (case-insensitive) against agency-org
--     owners' `auth.users.email`, falling back to `agencies.email`.
--   * If the recipient agency cannot be resolved → exception
--     `recipient_agency_not_found`. The frontend then guides the sender to
--     invite the recipient via `send-agency-share-invite` Edge Function.
--   * The raw email is also stored in `target_agency_email` for audit.
--
-- Return: (link_id, target_agency_id, target_agency_name).
--
-- Idempotent function definition. Single migration; not deployed via root
-- supabase/*.sql.
-- =============================================================================

DROP FUNCTION IF EXISTS public.create_agency_share_package(uuid, text, uuid[], text, timestamptz);

CREATE OR REPLACE FUNCTION public.create_agency_share_package(
  p_organization_id uuid,
  p_recipient_email text,
  p_model_ids uuid[],
  p_label text DEFAULT NULL,
  p_expires_at timestamptz DEFAULT NULL
)
RETURNS TABLE(link_id uuid, target_agency_id uuid, target_agency_name text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_caller            uuid;
  v_sender_agency_id  uuid;
  v_target_agency_id  uuid;
  v_target_agency_name text;
  v_normalized_email  text;
  v_invalid_count     integer;
  v_link_id           uuid;
  v_expires           timestamptz;
BEGIN
  v_caller := auth.uid();
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'organization_id_required';
  END IF;

  IF p_recipient_email IS NULL OR length(trim(p_recipient_email)) = 0 THEN
    RAISE EXCEPTION 'recipient_email_required';
  END IF;

  IF p_model_ids IS NULL OR array_length(p_model_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'model_ids_required';
  END IF;

  v_normalized_email := lower(trim(p_recipient_email));

  -- 1) Sender membership: caller must be member of p_organization_id (agency org)
  SELECT o.agency_id INTO v_sender_agency_id
  FROM public.organization_members om
  JOIN public.organizations o ON o.id = om.organization_id
  WHERE om.user_id = v_caller
    AND om.organization_id = p_organization_id
    AND o.type = 'agency'
    AND o.agency_id IS NOT NULL;

  IF v_sender_agency_id IS NULL THEN
    RAISE EXCEPTION 'not_member_of_sender_organization';
  END IF;

  -- 2) Validate every model belongs to the sender as home agency (v1 scope)
  SELECT count(*) INTO v_invalid_count
  FROM unnest(p_model_ids) AS x(model_id)
  LEFT JOIN public.models m ON m.id = x.model_id
  WHERE m.id IS NULL OR m.agency_id IS DISTINCT FROM v_sender_agency_id;

  IF v_invalid_count > 0 THEN
    RAISE EXCEPTION 'invalid_models_for_sender'
      USING DETAIL = format('%s of %s models do not belong to sender agency',
        v_invalid_count, array_length(p_model_ids, 1));
  END IF;

  -- 3) Recipient resolution — primary: agency-org owner via auth.users.email
  SELECT o.agency_id, COALESCE(a.name, o.name)
    INTO v_target_agency_id, v_target_agency_name
  FROM public.organization_members om
  JOIN public.organizations o ON o.id = om.organization_id
  JOIN auth.users u ON u.id = om.user_id
  LEFT JOIN public.agencies a ON a.id = o.agency_id
  WHERE o.type = 'agency'
    AND o.agency_id IS NOT NULL
    AND om.role = 'owner'
    AND lower(trim(u.email)) = v_normalized_email
  ORDER BY om.created_at ASC
  LIMIT 1;

  -- 4) Fallback: any agency-org member with this email
  IF v_target_agency_id IS NULL THEN
    SELECT o.agency_id, COALESCE(a.name, o.name)
      INTO v_target_agency_id, v_target_agency_name
    FROM public.organization_members om
    JOIN public.organizations o ON o.id = om.organization_id
    JOIN auth.users u ON u.id = om.user_id
    LEFT JOIN public.agencies a ON a.id = o.agency_id
    WHERE o.type = 'agency'
      AND o.agency_id IS NOT NULL
      AND lower(trim(u.email)) = v_normalized_email
    ORDER BY om.created_at ASC
    LIMIT 1;
  END IF;

  -- 5) Fallback: legacy agencies.email column
  IF v_target_agency_id IS NULL THEN
    SELECT a.id, a.name INTO v_target_agency_id, v_target_agency_name
    FROM public.agencies a
    WHERE lower(trim(a.email)) = v_normalized_email
    ORDER BY a.created_at ASC
    LIMIT 1;
  END IF;

  IF v_target_agency_id IS NULL THEN
    RAISE EXCEPTION 'recipient_agency_not_found'
      USING HINT = 'Recipient agency must have an account before a roster share can be sent.';
  END IF;

  -- Self-share guard
  IF v_target_agency_id = v_sender_agency_id THEN
    RAISE EXCEPTION 'cannot_share_with_self';
  END IF;

  v_expires := COALESCE(p_expires_at, now() + interval '14 days');

  -- 6) Insert the share row. type = 'mixed' so portfolio+polaroid both flow.
  INSERT INTO public.guest_links (
    agency_id,
    model_ids,
    type,
    label,
    purpose,
    target_agency_id,
    target_agency_email,
    expires_at,
    is_active,
    created_by
  )
  VALUES (
    v_sender_agency_id,
    p_model_ids,
    'mixed',
    p_label,
    'agency_share',
    v_target_agency_id,
    v_normalized_email,
    v_expires,
    true,
    v_caller
  )
  RETURNING id INTO v_link_id;

  link_id := v_link_id;
  target_agency_id := v_target_agency_id;
  target_agency_name := v_target_agency_name;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.create_agency_share_package(uuid, text, uuid[], text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_agency_share_package(uuid, text, uuid[], text, timestamptz) TO authenticated;

COMMENT ON FUNCTION public.create_agency_share_package(uuid, text, uuid[], text, timestamptz) IS
  'Agency-to-Agency Roster Share (20261024). Creates guest_links row with purpose=agency_share '
  'after validating sender membership, model home-agency ownership, and resolving recipient agency by email.';
