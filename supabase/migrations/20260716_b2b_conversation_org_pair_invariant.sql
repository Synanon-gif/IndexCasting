-- =============================================================================
-- B2B CONVERSATION ORG-PAIR INVARIANT (2026-07-16)
--
-- Ensures: one canonical B2B conversation per (client_org, agency_org) pair.
-- All org members automatically land in the same conversation.
--
-- Fixes:
--   A) resolve_b2b_chat_organization_ids: SET row_security TO off + ORDER BY
--   B) Trigger fn_sync_b2b_conversation_participants: keeps participant_ids
--      in sync when members join/leave an organization
--   C) Backfill: add missing org members to existing B2B conversation
--      participant_ids
--
-- Idempotent: CREATE OR REPLACE, DROP TRIGGER IF EXISTS.
-- =============================================================================


-- ─── FIX A: resolve_b2b_chat_organization_ids ──────────────────────────────
--
-- 1. SET row_security TO off — PFLICHT for SECURITY DEFINER reading
--    RLS-protected tables (profiles, organization_members, organizations).
-- 2. ORDER BY m.created_at ASC on all LIMIT 1 queries — deterministic org
--    resolution for multi-org users (oldest membership wins, consistent
--    with AuthContext convention).

CREATE OR REPLACE FUNCTION public.resolve_b2b_chat_organization_ids(
  p_client_user_id uuid,
  p_agency_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
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
    ORDER BY m.created_at ASC
    LIMIT 1;

    IF client_oid IS NULL THEN
      PERFORM public.ensure_client_organization();
      SELECT o.id INTO client_oid
      FROM public.organization_members m
      JOIN public.organizations o ON o.id = m.organization_id
      WHERE m.user_id = p_client_user_id AND o.type = 'client'
      ORDER BY m.created_at ASC
      LIMIT 1;
    END IF;
  ELSE
    SELECT o.id INTO client_oid
    FROM public.organization_members m
    JOIN public.organizations o ON o.id = m.organization_id
    WHERE m.user_id = p_client_user_id AND o.type = 'client'
    ORDER BY m.created_at ASC
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


-- ─── FIX B: Trigger to sync participant_ids on org membership changes ───────
--
-- When a user joins or leaves an organization, update participant_ids on all
-- B2B conversations that reference that organization (either side of the pair).
-- This ensures new employees/bookers immediately see and can interact with
-- existing B2B conversations without creating duplicates.

CREATE OR REPLACE FUNCTION public.fn_sync_b2b_conversation_participants()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_org_id uuid;
  v_user_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_org_id  := OLD.organization_id;
    v_user_id := OLD.user_id;

    UPDATE public.conversations
    SET participant_ids = array_remove(participant_ids, v_user_id)
    WHERE context_id IS NOT NULL
      AND context_id LIKE 'b2b:%'
      AND (client_organization_id = v_org_id OR agency_organization_id = v_org_id);

    RETURN OLD;
  END IF;

  -- INSERT (new member joined)
  v_org_id  := NEW.organization_id;
  v_user_id := NEW.user_id;

  UPDATE public.conversations
  SET participant_ids = participant_ids || ARRAY[v_user_id]
  WHERE context_id IS NOT NULL
    AND context_id LIKE 'b2b:%'
    AND (client_organization_id = v_org_id OR agency_organization_id = v_org_id)
    AND NOT (v_user_id = ANY(participant_ids));

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_b2b_conversation_participants ON public.organization_members;
CREATE TRIGGER trg_sync_b2b_conversation_participants
  AFTER INSERT OR DELETE ON public.organization_members
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_sync_b2b_conversation_participants();


-- ─── FIX C: Backfill existing conversations with missing participants ───────
--
-- One-time backfill: for every B2B conversation, ensure all current members
-- of both linked organizations are in participant_ids.

UPDATE public.conversations c
SET participant_ids = (
  SELECT array_agg(DISTINCT uid ORDER BY uid)
  FROM (
    SELECT unnest(c.participant_ids) AS uid
    UNION
    SELECT om.user_id
    FROM public.organization_members om
    WHERE om.organization_id = c.client_organization_id
    UNION
    SELECT om.user_id
    FROM public.organization_members om
    WHERE om.organization_id = c.agency_organization_id
  ) AS combined
)
WHERE c.context_id IS NOT NULL
  AND c.context_id LIKE 'b2b:%'
  AND c.client_organization_id IS NOT NULL
  AND c.agency_organization_id IS NOT NULL;


-- ─── VERIFICATION ───────────────────────────────────────────────────────────

DO $$
BEGIN
  -- 1. resolve_b2b_chat_organization_ids has SET row_security TO off
  ASSERT EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.proname = 'resolve_b2b_chat_organization_ids'
      AND p.pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
      AND p.prokind = 'f'
      AND 'row_security=off' = ANY(p.proconfig)
  ), 'FAIL: resolve_b2b_chat_organization_ids missing row_security=off';

  -- 2. resolve_b2b_chat_organization_ids has ORDER BY
  ASSERT EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.proname = 'resolve_b2b_chat_organization_ids'
      AND p.pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
      AND p.prokind = 'f'
      AND pg_get_functiondef(p.oid) ILIKE '%ORDER BY m.created_at ASC%'
  ), 'FAIL: resolve_b2b_chat_organization_ids missing ORDER BY';

  -- 3. Trigger exists
  ASSERT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_sync_b2b_conversation_participants'
      AND tgrelid = 'public.organization_members'::regclass
  ), 'FAIL: trg_sync_b2b_conversation_participants missing';

  -- 4. No duplicate b2b context_ids
  ASSERT NOT EXISTS (
    SELECT context_id FROM public.conversations
    WHERE context_id IS NOT NULL AND context_id LIKE 'b2b:%'
    GROUP BY context_id HAVING count(*) > 1
  ), 'FAIL: duplicate b2b context_ids exist';

  -- 5. Unique index exists
  ASSERT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'conversations'
      AND indexname = 'conversations_b2b_context_id_uq'
  ), 'FAIL: conversations_b2b_context_id_uq index missing';

  RAISE NOTICE 'ALL B2B ORG-PAIR INVARIANT VERIFICATIONS PASSED';
END $$;
