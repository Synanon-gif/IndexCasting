-- =============================================================================
-- 20261206_log_audit_action_allow_option_request_participants.sql
--
-- WHY: log_audit_action() requires the caller to be a member of p_org_id.
-- Models log option_request audit entries against the AGENCY org_id (since
-- option_requests.organization_id is the agency org), but models are NOT
-- members of the agency org → 403 (42501) "permission_denied: caller is not
-- a member of the specified organization".
--
-- Symptoms in production (2026-04-21):
--   modelConfirmOptionRequest → logAction(r.organization_id, 'option_confirmed', …)
--   → log_audit_action RPC → 42501 permission_denied
-- modelRejectOptionRequest had the same path (any model action that audits
-- against the agency org).
--
-- FIX: Extend the membership gate. If p_entity_type = 'option_request', allow
-- the call when the caller is a participant of that option_request (model,
-- agency org member, client, or client org member) — exactly the same set of
-- principals that already pass option_request_visible_to_me().
--
-- Cross-org-spoofing remains blocked: caller can ONLY log against an
-- option_request they participate in. The org_id is still the org context
-- (agency), so the audit_trail row is correctly grouped — just the membership
-- check is widened to participants.
--
-- Idempotent: full CREATE OR REPLACE.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.log_audit_action(
  p_org_id      UUID,
  p_action_type TEXT,
  p_entity_type TEXT    DEFAULT NULL,
  p_entity_id   UUID    DEFAULT NULL,
  p_old_data    JSONB   DEFAULT NULL,
  p_new_data    JSONB   DEFAULT NULL,
  p_ip_address  TEXT    DEFAULT NULL,
  p_source      TEXT    DEFAULT 'api'
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_source    TEXT := coalesce(p_source, 'api');
  v_allowed   BOOLEAN := false;
BEGIN
  IF v_source NOT IN ('api', 'rpc', 'system', 'trigger') THEN
    v_source := 'api';
  END IF;

  -- Path A: Admins can always log (no membership constraint)
  IF public.is_current_user_admin() THEN
    v_allowed := true;

  -- Path B: No org context required → anyone authenticated may log
  -- (used by GDPR-internal flows: consent_withdrawn, image_rights_confirmation, etc.)
  ELSIF p_org_id IS NULL THEN
    v_allowed := true;

  -- Path C: Caller is a member of the specified org (canonical path)
  ELSIF EXISTS (
    SELECT 1
    FROM public.organization_members
    WHERE user_id         = v_caller_id
      AND organization_id = p_org_id
  ) THEN
    v_allowed := true;

  -- Path D: option_request participant — caller is the model, agency
  -- org member, client, or client org member of THIS option_request.
  -- Reuses the canonical visibility helper (covers all participant variants).
  ELSIF p_entity_type = 'option_request'
     AND p_entity_id IS NOT NULL
     AND public.option_request_visible_to_me(p_entity_id) THEN
    v_allowed := true;
  END IF;

  IF NOT v_allowed THEN
    RAISE EXCEPTION 'permission_denied: caller is not a member of the specified organization'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  INSERT INTO public.audit_trail (
    user_id,
    org_id,
    action_type,
    entity_type,
    entity_id,
    old_data,
    new_data,
    ip_address,
    source,
    created_at
  ) VALUES (
    v_caller_id,
    p_org_id,
    p_action_type,
    p_entity_type,
    p_entity_id,
    p_old_data,
    p_new_data,
    p_ip_address,
    v_source,
    NOW()
  );
END;
$$;

REVOKE ALL    ON FUNCTION public.log_audit_action(UUID, TEXT, TEXT, UUID, JSONB, JSONB, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_audit_action(UUID, TEXT, TEXT, UUID, JSONB, JSONB, TEXT, TEXT) TO authenticated;

COMMENT ON FUNCTION public.log_audit_action IS
  'SECURE (20261206): Adds option_request participant fallback. Admins always allowed. '
  'p_org_id NULL → no membership check (GDPR-internal). Otherwise: caller must be org member, '
  'OR (when entity_type=option_request) a participant of that request '
  '(model / agency org member / client / client org member). Prevents 42501 in '
  'model-driven option flows (modelConfirmOptionRequest, modelRejectOptionRequest).';

-- ─── Verification ────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_src text;
BEGIN
  SELECT prosrc INTO v_src
  FROM pg_proc
  WHERE proname = 'log_audit_action'
    AND pronargs = 8;

  ASSERT v_src ILIKE '%option_request_visible_to_me%',
    'FAIL: log_audit_action does not include option_request participant fallback';

  ASSERT v_src ILIKE '%is_current_user_admin%',
    'FAIL: log_audit_action lost is_current_user_admin admin path';

  RAISE NOTICE 'PASS: 20261206_log_audit_action_allow_option_request_participants — verifications passed';
END $$;
