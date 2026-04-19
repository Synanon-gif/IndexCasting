-- =============================================================================
-- External Sync Outbox — F1.1: Agency-callable mark RPCs (Audit 2026-11-03)
--
-- Problem (Phase 0 baseline):
--   `mark_external_sync_outbox_sent`, `mark_external_sync_outbox_failed` and
--   `list_pending_external_sync_outbox` (20261027) all enforce admin-only.
--   But the canonical use-case is `src/services/externalCalendarSync.ts`
--   (`pushOne` / `markOutboxSent` / `markOutboxFailed`) — called fire-and-forget
--   from the agency-member frontend right after a best-effort direct push.
--   Under admin-only those calls always fail → outbox rows stay 'pending'
--   forever, the cron worker re-pushes already-delivered events, and the
--   `attempts >= 5 → failed` auto-promotion never fires from the user path.
--
-- Fix (minimal, additive — no behaviour change for existing admin paths):
--   * `mark_*` → admin OR agency-member of the outbox row's agency_id
--     (resolved via JOIN), OR `auth.uid() IS NULL` (service-role context for
--     the cron worker / edge function).
--   * `list_pending_*` → admin OR `auth.uid() IS NULL` (worker-only). Agency
--     members do not need to list pending rows; the SELECT RLS policy already
--     covers introspection of their own outbox.
--
-- Invariants preserved:
--   - `enqueue_external_sync_outbox` (org-membership-gated) is unchanged.
--   - SELECT RLS on `external_sync_outbox` is unchanged (agency-scoped read).
--   - Direct INSERT/UPDATE/DELETE remain blocked — only these RPCs may write.
--   - `row_security TO off` keeps consistency with §I + Risk 4 (Sec-Def Helper
--     pattern); guards are explicit inside each function.
--   - Idempotency contract of `enqueue_external_sync_outbox` (idempotency_key
--     unique partial index) is unchanged.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. mark_external_sync_outbox_sent — admin OR agency-member OR service-role
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.mark_external_sync_outbox_sent(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_agency_id uuid;
  v_allowed   boolean := false;
BEGIN
  -- Service-role / cron worker context: no auth.uid() → always allowed.
  IF v_uid IS NULL THEN
    UPDATE public.external_sync_outbox
       SET status = 'sent', sent_at = now()
     WHERE id = p_id;
    RETURN;
  END IF;

  -- Admin shortcut.
  IF public.is_current_user_admin() THEN
    UPDATE public.external_sync_outbox
       SET status = 'sent', sent_at = now()
     WHERE id = p_id;
    RETURN;
  END IF;

  -- Resolve the outbox row's agency_id.
  SELECT agency_id INTO v_agency_id
    FROM public.external_sync_outbox
   WHERE id = p_id;

  IF v_agency_id IS NULL THEN
    -- Row missing → treat as no-op (idempotent: row may already be deleted).
    RETURN;
  END IF;

  -- Agency-member guard (same shape as enqueue_external_sync_outbox).
  SELECT EXISTS (
    SELECT 1
      FROM public.organization_members om
      JOIN public.organizations org ON org.id = om.organization_id
     WHERE om.user_id  = v_uid
       AND org.agency_id = v_agency_id
       AND org.type   = 'agency'
  ) OR EXISTS (
    SELECT 1
      FROM public.bookers b
     WHERE b.agency_id = v_agency_id
       AND b.user_id   = v_uid
  )
  INTO v_allowed;

  IF NOT v_allowed THEN
    RAISE EXCEPTION 'mark_external_sync_outbox_sent: caller % is not in agency %',
      v_uid, v_agency_id;
  END IF;

  UPDATE public.external_sync_outbox
     SET status = 'sent', sent_at = now()
   WHERE id = p_id;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_external_sync_outbox_sent(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_external_sync_outbox_sent(uuid) TO authenticated;

COMMENT ON FUNCTION public.mark_external_sync_outbox_sent IS
  'Marks an outbox row as sent. Allowed for: admin, agency-member of the row''s '
  'agency_id (best-effort direct push from frontend), and service-role (cron worker).';

-- ---------------------------------------------------------------------------
-- 2. mark_external_sync_outbox_failed — admin OR agency-member OR service-role
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.mark_external_sync_outbox_failed(
  p_id    uuid,
  p_error text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_agency_id uuid;
  v_allowed   boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    UPDATE public.external_sync_outbox
       SET attempts   = attempts + 1,
           last_error = p_error,
           status     = CASE WHEN attempts + 1 >= 5 THEN 'failed' ELSE 'pending' END
     WHERE id = p_id;
    RETURN;
  END IF;

  IF public.is_current_user_admin() THEN
    UPDATE public.external_sync_outbox
       SET attempts   = attempts + 1,
           last_error = p_error,
           status     = CASE WHEN attempts + 1 >= 5 THEN 'failed' ELSE 'pending' END
     WHERE id = p_id;
    RETURN;
  END IF;

  SELECT agency_id INTO v_agency_id
    FROM public.external_sync_outbox
   WHERE id = p_id;

  IF v_agency_id IS NULL THEN
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1
      FROM public.organization_members om
      JOIN public.organizations org ON org.id = om.organization_id
     WHERE om.user_id  = v_uid
       AND org.agency_id = v_agency_id
       AND org.type   = 'agency'
  ) OR EXISTS (
    SELECT 1
      FROM public.bookers b
     WHERE b.agency_id = v_agency_id
       AND b.user_id   = v_uid
  )
  INTO v_allowed;

  IF NOT v_allowed THEN
    RAISE EXCEPTION 'mark_external_sync_outbox_failed: caller % is not in agency %',
      v_uid, v_agency_id;
  END IF;

  UPDATE public.external_sync_outbox
     SET attempts   = attempts + 1,
         last_error = p_error,
         status     = CASE WHEN attempts + 1 >= 5 THEN 'failed' ELSE 'pending' END
   WHERE id = p_id;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_external_sync_outbox_failed(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_external_sync_outbox_failed(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.mark_external_sync_outbox_failed IS
  'Increments attempts and records last_error. Auto-promotes to status=failed '
  'after 5 attempts. Allowed for admin, agency-member of the row''s agency_id, '
  'and service-role (cron worker).';

-- ---------------------------------------------------------------------------
-- 3. list_pending_external_sync_outbox — admin OR service-role only
-- ---------------------------------------------------------------------------
--
-- Worker-only path. Agency members already have full read access via the
-- existing SELECT RLS policy ("external_sync_outbox_select_agency_members"),
-- so a separate listing function is not needed for them.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.list_pending_external_sync_outbox(
  p_provider text DEFAULT NULL,
  p_limit    int  DEFAULT 50
)
RETURNS SETOF public.external_sync_outbox
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
BEGIN
  -- Service-role context (no auth.uid()) OR explicit admin caller.
  IF auth.uid() IS NOT NULL AND NOT public.is_current_user_admin() THEN
    RAISE EXCEPTION 'list_pending_external_sync_outbox: worker-only (admin or service-role)';
  END IF;

  RETURN QUERY
  SELECT *
    FROM public.external_sync_outbox
   WHERE status = 'pending'
     AND (p_provider IS NULL OR provider = p_provider)
   ORDER BY created_at ASC
   LIMIT GREATEST(1, LEAST(p_limit, 500));
END;
$$;

REVOKE ALL ON FUNCTION public.list_pending_external_sync_outbox(text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_pending_external_sync_outbox(text, int) TO authenticated;

COMMENT ON FUNCTION public.list_pending_external_sync_outbox IS
  'Worker-only: returns pending outbox rows. Allowed for admin and service-role '
  '(cron worker / edge function). Agency members read via SELECT RLS instead.';
