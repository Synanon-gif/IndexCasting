-- =============================================================================
-- B2B participant sync trigger — exception safety (2026-07-17)
--
-- The trigger fn_sync_b2b_conversation_participants must NEVER block
-- INSERT/DELETE on organization_members if the participant_ids UPDATE fails.
-- Org membership changes are critical; B2B participant sync is best-effort.
-- =============================================================================

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

    BEGIN
      UPDATE public.conversations
      SET participant_ids = array_remove(participant_ids, v_user_id)
      WHERE context_id IS NOT NULL
        AND context_id LIKE 'b2b:%'
        AND (client_organization_id = v_org_id OR agency_organization_id = v_org_id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '[fn_sync_b2b_conversation_participants] DELETE sync failed for user % in org %: %', v_user_id, v_org_id, SQLERRM;
    END;

    RETURN OLD;
  END IF;

  -- INSERT (new member joined)
  v_org_id  := NEW.organization_id;
  v_user_id := NEW.user_id;

  BEGIN
    UPDATE public.conversations
    SET participant_ids = participant_ids || ARRAY[v_user_id]
    WHERE context_id IS NOT NULL
      AND context_id LIKE 'b2b:%'
      AND (client_organization_id = v_org_id OR agency_organization_id = v_org_id)
      AND NOT (v_user_id = ANY(participant_ids));
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[fn_sync_b2b_conversation_participants] INSERT sync failed for user % in org %: %', v_user_id, v_org_id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

-- Trigger already exists from previous migration; function body is replaced in-place.

-- ─── VERIFICATION ───────────────────────────────────────────────────────────

DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.proname = 'fn_sync_b2b_conversation_participants'
      AND p.pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
      AND p.prokind = 'f'
      AND pg_get_functiondef(p.oid) ILIKE '%EXCEPTION WHEN OTHERS%'
  ), 'FAIL: fn_sync_b2b_conversation_participants missing exception handler';

  ASSERT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_sync_b2b_conversation_participants'
      AND tgrelid = 'public.organization_members'::regclass
  ), 'FAIL: trigger missing';

  RAISE NOTICE 'B2B participant sync exception safety verified';
END $$;
