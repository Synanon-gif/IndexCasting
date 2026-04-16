-- Final hardening: service-role participant strip before auth delete; admin read-only diagnostics.
-- No auto-linking; no broad email matching in product paths — admin RPCs only.

-- ─── 1. Strip one user from all conversation participant arrays (pre-delete; Edge delete-user)
CREATE OR REPLACE FUNCTION public.remove_user_from_conversation_participants(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'permission_denied' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_user_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.conversations c
  SET participant_ids = COALESCE(
    ARRAY(
      SELECT uid
      FROM unnest(c.participant_ids) AS uid
      WHERE uid IS DISTINCT FROM p_user_id
    ),
    ARRAY[]::uuid[]
  )
  WHERE c.participant_ids IS NOT NULL
    AND cardinality(c.participant_ids) > 0
    AND p_user_id = ANY (c.participant_ids);
END;
$$;

REVOKE ALL ON FUNCTION public.remove_user_from_conversation_participants(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.remove_user_from_conversation_participants(uuid) TO service_role;

COMMENT ON FUNCTION public.remove_user_from_conversation_participants(uuid) IS
  'Removes p_user_id from conversations.participant_ids. service_role only (e.g. delete-user Edge before auth.admin.deleteUser).';


-- ─── 2. Admin: model email matches auth.users but models.user_id is NULL (read-only diagnostic)
CREATE OR REPLACE FUNCTION public.admin_detect_model_link_inconsistencies(p_model_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
SET row_security TO off
AS $$
DECLARE
  m_email text;
  m_user_id uuid;
  auth_uid uuid;
BEGIN
  PERFORM public.assert_is_admin();

  IF p_model_id IS NULL THEN
    RETURN jsonb_build_object('inconsistent', false, 'reasons', '[]'::jsonb);
  END IF;

  SELECT trim(both from m.email), m.user_id
  INTO m_email, m_user_id
  FROM public.models m
  WHERE m.id = p_model_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('inconsistent', false, 'reasons', '[]'::jsonb);
  END IF;

  IF m_user_id IS NOT NULL THEN
    RETURN jsonb_build_object('inconsistent', false, 'reasons', '[]'::jsonb);
  END IF;

  IF m_email IS NULL OR length(m_email) = 0 THEN
    RETURN jsonb_build_object('inconsistent', false, 'reasons', '[]'::jsonb);
  END IF;

  SELECT u.id
  INTO auth_uid
  FROM auth.users u
  WHERE lower(trim(u.email::text)) = lower(m_email)
  LIMIT 1;

  IF auth_uid IS NOT NULL THEN
    RETURN jsonb_build_object(
      'inconsistent', true,
      'reasons',
      jsonb_build_array(
        'model has email matching auth.users but user_id is null — manual claim/link required; no auto-link'
      ),
      'auth_user_id', auth_uid
    );
  END IF;

  RETURN jsonb_build_object('inconsistent', false, 'reasons', '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_detect_model_link_inconsistencies(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_detect_model_link_inconsistencies(uuid) TO authenticated;

COMMENT ON FUNCTION public.admin_detect_model_link_inconsistencies(uuid) IS
  'Admin-only: detects half-linked model rows (email matches auth user, user_id NULL). Logging/diagnostics only; never auto-links.';


-- ─── 3. Admin: models still pointing at a missing auth user (integrity drift diagnostic)
CREATE OR REPLACE FUNCTION public.admin_detect_orphaned_model_rows(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
SET row_security TO off
AS $$
DECLARE
  v_count integer;
  v_sample jsonb;
BEGIN
  PERFORM public.assert_is_admin();

  IF p_user_id IS NULL THEN
    RETURN jsonb_build_object('orphan_count', 0, 'sample_model_ids', '[]'::jsonb);
  END IF;

  SELECT count(*)::integer
  INTO v_count
  FROM public.models m
  WHERE m.user_id = p_user_id
    AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = m.user_id);

  SELECT coalesce(
    jsonb_agg(to_jsonb(s.id)),
    '[]'::jsonb
  )
  INTO v_sample
  FROM (
    SELECT m.id
    FROM public.models m
    WHERE m.user_id = p_user_id
      AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = m.user_id)
    ORDER BY m.id
    LIMIT 20
  ) s;

  RETURN jsonb_build_object('orphan_count', coalesce(v_count, 0), 'sample_model_ids', coalesce(v_sample, '[]'::jsonb));
END;
$$;

REVOKE ALL ON FUNCTION public.admin_detect_orphaned_model_rows(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_detect_orphaned_model_rows(uuid) TO authenticated;

COMMENT ON FUNCTION public.admin_detect_orphaned_model_rows(uuid) IS
  'Admin-only: counts models with user_id set but no auth.users row (should be zero if FK/cascade healthy). Read-only diagnostic.';
