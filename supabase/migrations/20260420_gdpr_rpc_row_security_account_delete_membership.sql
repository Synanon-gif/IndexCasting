-- =============================================================================
-- GDPR RPCs + account deletion: row_security=off, canonical audit, membership-based delete guard
--
-- 1) withdraw_consent — was only in legacy root SQL; add row_security=off,
--    idempotent success when no active rows, correct audit via log_audit_action.
-- 2) export_user_data — same; admin gate via is_current_user_admin / super_admin RPCs
--    (not raw profiles under RLS); export completion logged via log_audit_action.
-- 3) request_account_deletion — owner check from organization_members + org type only
--    (no profiles.role branch).
-- =============================================================================

-- ─── 1. withdraw_consent ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.withdraw_consent(
  p_consent_type TEXT,
  p_reason       TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_uid   UUID := auth.uid();
  v_count INTEGER;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF p_consent_type IS NULL OR length(trim(p_consent_type)) = 0 THEN
    RAISE EXCEPTION 'invalid_consent_type';
  END IF;

  UPDATE public.consent_log
  SET
    withdrawn_at      = now(),
    withdrawal_reason = p_reason
  WHERE user_id      = v_uid
    AND consent_type = p_consent_type
    AND withdrawn_at IS NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- Idempotent: no active rows → still success, no duplicate audit noise
  IF v_count > 0 THEN
    PERFORM public.log_audit_action(
      NULL,
      'consent_withdrawn',
      'consent_log',
      NULL,
      NULL,
      jsonb_build_object(
        'consent_type', p_consent_type,
        'withdrawn_at', now(),
        'reason', p_reason
      ),
      NULL,
      'api'
    );
  END IF;

  RETURN true;
END;
$$;

REVOKE ALL    ON FUNCTION public.withdraw_consent(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.withdraw_consent(TEXT, TEXT) TO authenticated;

COMMENT ON FUNCTION public.withdraw_consent(TEXT, TEXT) IS
  'GDPR Art. 7(3): withdraws active consents of p_consent_type for the caller. '
  'SECURITY DEFINER + row_security=off. Idempotent: second call returns true. '
  'Audit via log_audit_action (action_type=consent_withdrawn, source=api).';


-- ─── 2. export_user_data ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.export_user_data(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_uid    UUID := auth.uid();
  v_result JSONB;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'invalid_user_id';
  END IF;

  -- Own data, or platform admin / super-admin (UUID+email-pinned RPCs)
  IF v_uid <> p_user_id
     AND NOT public.is_current_user_admin()
     AND NOT public.is_current_user_super_admin() THEN
    RAISE EXCEPTION 'permission_denied: can only export own data';
  END IF;

  SELECT jsonb_build_object(
    'exported_at',   now(),
    'user_id',       p_user_id,

    'profile', (
      SELECT row_to_json(p)::JSONB
      FROM (
        SELECT id, email, display_name, role, phone, website, country,
               company_name, created_at, tos_accepted, privacy_accepted,
               deletion_requested_at
        FROM public.profiles WHERE id = p_user_id
      ) p
    ),

    'consent_log', (
      SELECT jsonb_agg(row_to_json(c))
      FROM (
        SELECT consent_type, version, accepted_at, ip_address
        FROM public.consent_log WHERE user_id = p_user_id
        ORDER BY accepted_at DESC
      ) c
    ),

    'organizations', (
      SELECT jsonb_agg(row_to_json(o))
      FROM (
        SELECT om.role, om.created_at AS joined_at,
               org.type AS org_type, org.id AS org_id
        FROM public.organization_members om
        JOIN public.organizations org ON org.id = om.organization_id
        WHERE om.user_id = p_user_id
      ) o
    ),

    'messages_sent', (
      SELECT jsonb_agg(row_to_json(m))
      FROM (
        SELECT id, conversation_id, text, created_at
        FROM public.messages
        WHERE sender_id = p_user_id
        ORDER BY created_at DESC
        LIMIT 1000
      ) m
    ),

    'option_requests', (
      SELECT jsonb_agg(row_to_json(r))
      FROM (
        SELECT id, model_id, requested_date, final_status, created_at
        FROM public.option_requests
        WHERE created_by = p_user_id
        ORDER BY created_at DESC
        LIMIT 500
      ) r
    ),

    'calendar_events', (
      SELECT jsonb_agg(row_to_json(e))
      FROM (
        SELECT id, title, start_date, end_date, event_type, created_at
        FROM public.user_calendar_events
        WHERE owner_id = p_user_id
        ORDER BY created_at DESC
        LIMIT 500
      ) e
    ),

    'audit_trail', (
      SELECT jsonb_agg(row_to_json(a))
      FROM (
        SELECT action_type, entity_type, entity_id, created_at
        FROM public.audit_trail
        WHERE user_id = p_user_id
        ORDER BY created_at DESC
        LIMIT 500
      ) a
    ),

    'image_rights_confirmations', (
      SELECT jsonb_agg(row_to_json(i))
      FROM (
        SELECT model_id, confirmed_at, ip_address
        FROM public.image_rights_confirmations
        WHERE user_id = p_user_id
        ORDER BY confirmed_at DESC
      ) i
    )
  ) INTO v_result;

  PERFORM public.log_audit_action(
    NULL,
    'data_exported',
    'profile',
    p_user_id,
    NULL,
    jsonb_build_object('requested_by', v_uid, 'exported_user', p_user_id),
    NULL,
    'api'
  );

  RETURN v_result;
END;
$$;

REVOKE ALL    ON FUNCTION public.export_user_data(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.export_user_data(UUID) TO authenticated;

COMMENT ON FUNCTION public.export_user_data(UUID) IS
  'GDPR Art. 20 — Data portability JSONB. SECURITY DEFINER + row_security=off. '
  'Caller may export own row; admins via is_current_user_admin / is_current_user_super_admin. '
  'Logged via log_audit_action (data_exported, source=api).';


-- ─── 3. request_account_deletion (membership-based owner gate) ──────────────

CREATE OR REPLACE FUNCTION public.request_account_deletion()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN false;
  END IF;

  -- Any non-owner membership in an agency org blocks soft-delete (use personal RPC instead)
  IF EXISTS (
    SELECT 1
    FROM public.organization_members m
    JOIN public.organizations o ON o.id = m.organization_id AND o.type = 'agency'
    WHERE m.user_id = auth.uid()
      AND m.role::text <> 'owner'
  ) THEN
    RAISE EXCEPTION 'only_organization_owner_can_delete_account';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.organization_members m
    JOIN public.organizations o ON o.id = m.organization_id AND o.type = 'client'
    WHERE m.user_id = auth.uid()
      AND m.role::text <> 'owner'
  ) THEN
    RAISE EXCEPTION 'only_organization_owner_can_delete_account';
  END IF;

  UPDATE public.profiles
  SET deletion_requested_at = now(), updated_at = now()
  WHERE id = auth.uid();

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.request_account_deletion() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_account_deletion() TO authenticated;

COMMENT ON FUNCTION public.request_account_deletion() IS
  'Soft-delete request: sets profiles.deletion_requested_at. '
  'Owner gate uses organization_members + organizations.type only (no profiles.role). '
  'Non-owners use request_personal_account_deletion. row_security=off; scoped to auth.uid().';


-- ─── Verification ─────────────────────────────────────────────────────────────
DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'withdraw_consent'
      AND p.prosecdef = true
      AND 'row_security=off' = ANY(p.proconfig)
  ), 'FAIL: withdraw_consent must be SECURITY DEFINER with row_security=off';

  ASSERT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'export_user_data'
      AND p.prosecdef = true
      AND 'row_security=off' = ANY(p.proconfig)
  ), 'FAIL: export_user_data must be SECURITY DEFINER with row_security=off';

  ASSERT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'request_account_deletion'
      AND p.prosecdef = true
      AND 'row_security=off' = ANY(p.proconfig)
  ), 'FAIL: request_account_deletion must be SECURITY DEFINER with row_security=off';

  RAISE NOTICE 'PASS: 20260420_gdpr_rpc_row_security_account_delete_membership';
END $$;
