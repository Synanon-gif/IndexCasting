-- =============================================================================
-- GDPR mini-hardening: conversation participant cleanup, export guardrail helper,
-- retention comments (no RLS / no schema breakage / no deletion jobs).
-- =============================================================================

-- ─── 1. cleanup_conversation_participants — remove auth.users IDs that no longer exist
CREATE OR REPLACE FUNCTION public.cleanup_conversation_participants()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
BEGIN
  -- service_role: Edge/cron; authenticated: platform admin only (UUID+email pin)
  IF auth.role() = 'service_role' THEN
    NULL;
  ELSIF NOT public.is_current_user_admin() THEN
    RAISE EXCEPTION 'permission_denied' USING ERRCODE = 'insufficient_privilege';
  END IF;

  UPDATE public.conversations c
  SET participant_ids = COALESCE(
    ARRAY(
      SELECT uid
      FROM unnest(c.participant_ids) AS uid
      WHERE EXISTS (SELECT 1 FROM auth.users u WHERE u.id = uid)
    ),
    ARRAY[]::uuid[]
  )
  WHERE c.participant_ids IS NOT NULL
    AND cardinality(c.participant_ids) > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_conversation_participants() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleanup_conversation_participants() TO service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_conversation_participants() TO authenticated;

COMMENT ON FUNCTION public.cleanup_conversation_participants() IS
  'Removes UUIDs from conversations.participant_ids when no matching auth.users row exists. '
  'Callable by service_role (e.g. delete-user Edge) or platform admin. SECURITY DEFINER + row_security=off.';


-- ─── 2. Informational: tables considered in export_user_data (for PR / ops review)
CREATE OR REPLACE FUNCTION public.get_user_related_tables()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  RETURN jsonb_build_array(
    'profiles',
    'consent_log',
    'legal_acceptances',
    'organization_members',
    'messages',
    'conversations',
    'recruiting_chat_threads',
    'recruiting_chat_messages',
    'option_requests',
    'user_calendar_events',
    'calendar_entries',
    'notifications',
    'activity_logs',
    'audit_trail',
    'image_rights_confirmations',
    'push_tokens'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_user_related_tables() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_related_tables() TO authenticated;

COMMENT ON FUNCTION public.get_user_related_tables() IS
  'Informational JSON list of user-data tables covered by export_user_data (v2). '
  'Update when export_user_data is extended. Not a security boundary.';


-- ─── 3. export_user_data — developer guardrail (COMMENT only; function body unchanged here)
COMMENT ON FUNCTION public.export_user_data(uuid) IS
  'GDPR Art. 15/20 — Extended JSONB export (v2). SECURITY DEFINER + row_security=off. '
  'Logged via log_audit_action (data_exported, source=api). '
  'GDPR EXPORT GUARDRail: whenever a new user-related table is added, evaluate inclusion in export_user_data '
  'and update get_user_related_tables() + docs/GDPR_EXPORT_CHECKLIST.md.';


-- ─── 4. Table comments — retention visibility (documentation in catalog; not enforced by jobs)
COMMENT ON TABLE public.conversations IS
  'B2B/org-scoped threads. participant_ids may contain stale UUIDs until cleanup_conversation_participants() is run; '
  'no FK to auth.users.';

COMMENT ON TABLE public.messages IS
  'Retention: business record — no automatic row deletion by retention job in app (see docs/DATA_RETENTION_POLICY.md).';

COMMENT ON TABLE public.calendar_entries IS
  'Retention: operational scheduling — rows retained per product lifecycle (see docs/DATA_RETENTION_POLICY.md).';
