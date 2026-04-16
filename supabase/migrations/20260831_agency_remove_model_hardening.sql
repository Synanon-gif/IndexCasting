-- =============================================================================
-- 20260831: End representation — atomic MAT cleanup, multi-agency-safe model row,
--           agency↔model direct chat: block new messages without active MAT.
--
-- Canonical behavior:
--   • Ending representation for agency X removes ALL model_agency_territories
--     rows for (model_id, agency_id = X). No partial MAT for that pair remains.
--   • models row is never deleted; user_id untouched.
--   • If other MAT rows remain (other agencies / territories): models.agency_id
--     is set to the lexicographically smallest remaining agency_id; relationship
--     stays active; visibility flags are not cleared.
--   • If no MAT remains: agency_relationship_status = ended, visibility off,
--     agency_id = NULL (unrepresented / re-application ready).
--   • conversations/messages are not deleted; SELECT unchanged.
-- =============================================================================

-- ─── 1) Helper: agency-model direct threads require MAT for new messages ─────

CREATE OR REPLACE FUNCTION public.message_insert_agency_model_mat_ok(p_conversation_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_ctx   text;
  v_rest  text;
  v_agency uuid;
  v_model  uuid;
BEGIN
  IF p_conversation_id IS NULL THEN
    RETURN false;
  END IF;

  IF public.is_current_user_admin() THEN
    RETURN true;
  END IF;

  SELECT c.context_id INTO v_ctx
  FROM public.conversations c
  WHERE c.id = p_conversation_id
  LIMIT 1;

  IF v_ctx IS NULL OR v_ctx NOT LIKE 'agency-model:%' THEN
    RETURN true;
  END IF;

  v_rest := substr(v_ctx, length('agency-model:') + 1);
  IF v_rest IS NULL OR position(':' IN v_rest) < 1 THEN
    RETURN false;
  END IF;

  BEGIN
    v_agency := split_part(v_rest, ':', 1)::uuid;
    v_model := split_part(v_rest, ':', 2)::uuid;
  EXCEPTION
    WHEN invalid_text_representation THEN
      RETURN false;
  END;

  IF v_agency IS NULL OR v_model IS NULL THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.model_agency_territories mat
    WHERE mat.model_id = v_model
      AND mat.agency_id = v_agency
  );
END;
$$;

COMMENT ON FUNCTION public.message_insert_agency_model_mat_ok(uuid) IS
  '20260831: For conversations.context_id agency-model:{agency}:{model}, require '
  'an active MAT row for INSERT path checks; otherwise pass-through (not that pattern). '
  'Admin bypass. SECDEF row_security=off.';

REVOKE ALL ON FUNCTION public.message_insert_agency_model_mat_ok(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.message_insert_agency_model_mat_ok(uuid) TO authenticated;

-- ─── 2) Tighten messages INSERT (keep paywall + guest bypass from 20260536) ─

DROP POLICY IF EXISTS messages_insert_sender ON public.messages;

CREATE POLICY messages_insert_sender
  ON public.messages
  FOR INSERT
  TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND public.conversation_accessible_to_me(conversation_id)
    AND public.message_insert_agency_model_mat_ok(conversation_id)
    AND (
      public.has_platform_access()
      OR EXISTS (
        SELECT 1
        FROM public.conversations c
        WHERE c.id = conversation_id
          AND c.guest_user_id IS NOT NULL
          AND c.guest_user_id = auth.uid()
      )
    )
  );

COMMENT ON POLICY messages_insert_sender ON public.messages IS
  'B2B: paywall + accessible conversation + 20260536 guest bypass + 20260831 MAT gate '
  'for agency-model direct threads.';

-- ─── 3) agency_remove_model — MAT-first, multi-agency-safe ───────────────────

CREATE OR REPLACE FUNCTION public.agency_remove_model(p_model_id uuid, p_agency_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET row_security TO off
AS $function$
DECLARE
  can_act       boolean;
  v_deleted     int;
  v_remaining   int;
  v_next_agency uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.organization_members om
    JOIN public.organizations o ON o.id = om.organization_id
    WHERE om.user_id = auth.uid()
      AND o.type = 'agency'
      AND o.agency_id = p_agency_id
  ) OR EXISTS (
    SELECT 1 FROM public.bookers b WHERE b.user_id = auth.uid() AND b.agency_id = p_agency_id
  ) INTO can_act;

  IF NOT can_act THEN
    RAISE EXCEPTION 'Not authorized for this agency';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.models WHERE id = p_model_id) THEN
    RETURN false;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.model_agency_territories
    WHERE model_id = p_model_id AND agency_id = p_agency_id
  ) THEN
    RETURN false;
  END IF;

  DELETE FROM public.model_agency_territories
  WHERE model_id = p_model_id AND agency_id = p_agency_id;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  IF v_deleted < 1 THEN
    RETURN false;
  END IF;

  SELECT count(*)::int INTO v_remaining
  FROM public.model_agency_territories
  WHERE model_id = p_model_id;

  IF v_remaining > 0 THEN
    SELECT mat.agency_id INTO v_next_agency
    FROM public.model_agency_territories mat
    WHERE mat.model_id = p_model_id
    ORDER BY mat.agency_id ASC
    LIMIT 1;

    UPDATE public.models SET
      agency_id = v_next_agency,
      agency_relationship_status = 'active',
      agency_relationship_ended_at = NULL,
      updated_at = now()
    WHERE id = p_model_id;
  ELSE
    UPDATE public.models SET
      agency_relationship_status = 'ended',
      agency_relationship_ended_at = now(),
      is_visible_commercial = false,
      is_visible_fashion = false,
      agency_id = NULL,
      updated_at = now()
    WHERE id = p_model_id;
  END IF;

  RETURN true;
END;
$function$;

COMMENT ON FUNCTION public.agency_remove_model(uuid, uuid) IS
  '20260831: Removes all MAT for (model, agency); updates models row — if other MAT '
  'remains, re-points agency_id to smallest remaining agency and keeps active; else '
  'ended + no client visibility + agency_id NULL. Single transaction; no model/user delete.';

REVOKE ALL ON FUNCTION public.agency_remove_model(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agency_remove_model(uuid, uuid) TO authenticated;

-- ─── Verification ─────────────────────────────────────────────────────────────

DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'message_insert_agency_model_mat_ok'
  ), 'FAIL: message_insert_agency_model_mat_ok missing';

  ASSERT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'messages' AND policyname = 'messages_insert_sender'
  ), 'FAIL: messages_insert_sender missing';
END $$;
