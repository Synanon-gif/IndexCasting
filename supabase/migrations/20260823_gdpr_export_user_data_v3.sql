-- =============================================================================
-- GDPR: export_user_data v3 — subject-scoped option visibility, missing domains,
-- COALESCE(jsonb_agg), pseudonymized B2B participant/sender refs, invitations
-- without token. Adds option_request_visible_for_export_subject for admin exports.
-- =============================================================================

-- ─── Helpers: stable pseudonyms (no raw third-party UUIDs in export JSON) ───

CREATE OR REPLACE FUNCTION public.gdpr_export_actor_ref(p_actor uuid, p_subject uuid)
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT CASE
    WHEN p_actor IS NULL THEN NULL
    WHEN p_actor = p_subject THEN 'self'
    ELSE 'p_' || substr(encode(sha256((p_actor::text)::bytea), 'hex'), 1, 16)
  END
$$;

REVOKE ALL ON FUNCTION public.gdpr_export_actor_ref(uuid, uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.gdpr_export_participant_refs(p_ids uuid[], p_subject uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    (
      SELECT jsonb_agg(
        jsonb_build_object('ref', public.gdpr_export_actor_ref(pid, p_subject))
        ORDER BY ord
      )
      FROM unnest(p_ids) WITH ORDINALITY AS t(pid, ord)
    ),
    '[]'::jsonb
  );
$$;

REVOKE ALL ON FUNCTION public.gdpr_export_participant_refs(uuid[], uuid) FROM PUBLIC;

-- Same predicates as option_request_visible_to_me, but for an arbitrary subject user
-- (required when an admin exports another user's data — auth.uid() would be wrong).

CREATE OR REPLACE FUNCTION public.option_request_visible_for_export_subject(
  p_request_id uuid,
  p_subject_user_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.option_requests oq
    WHERE oq.id = p_request_id
      AND (
        EXISTS (
          SELECT 1 FROM public.models mo
          WHERE mo.id = oq.model_id AND mo.user_id = p_subject_user_id
        )
        OR (
          oq.client_organization_id IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM public.organization_members mc
            WHERE mc.organization_id = oq.client_organization_id
              AND mc.user_id = p_subject_user_id
          )
        )
        OR (
          oq.client_organization_id IS NULL
          AND oq.organization_id IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM public.organizations oc
            JOIN public.organization_members mc ON mc.organization_id = oc.id
            WHERE oc.id = oq.organization_id
              AND oc.type = 'client'
              AND mc.user_id = p_subject_user_id
          )
        )
        OR (
          oq.client_organization_id IS NULL
          AND oq.organization_id IS NULL
          AND oq.client_id = p_subject_user_id
        )
        OR (
          oq.client_id = p_subject_user_id
          AND (
            EXISTS (
              SELECT 1 FROM public.organization_members mc
              WHERE mc.user_id = p_subject_user_id
                AND oq.client_organization_id IS NOT NULL
                AND mc.organization_id = oq.client_organization_id
            )
            OR EXISTS (
              SELECT 1
              FROM public.organizations oc
              JOIN public.organization_members mc ON mc.organization_id = oc.id
              WHERE oc.id = oq.organization_id
                AND oc.type = 'client'
                AND mc.user_id = p_subject_user_id
            )
          )
        )
        OR (
          oq.agency_organization_id IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM public.organization_members ma
            WHERE ma.organization_id = oq.agency_organization_id
              AND ma.user_id = p_subject_user_id
              AND ma.role IN ('owner', 'booker')
          )
        )
        OR (
          oq.agency_id IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM public.organizations oa
            JOIN public.organization_members ma ON ma.organization_id = oa.id
            WHERE oa.agency_id = oq.agency_id
              AND oa.type = 'agency'
              AND ma.user_id = p_subject_user_id
              AND ma.role IN ('owner', 'booker')
          )
        )
      )
  );
$$;

REVOKE ALL ON FUNCTION public.option_request_visible_for_export_subject(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.option_request_visible_for_export_subject(uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.option_request_visible_for_export_subject(uuid, uuid) IS
  'GDPR export / admin: same visibility semantics as option_request_visible_to_me, '
  'but evaluated for p_subject_user_id instead of auth.uid().';

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
  v_email  TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'invalid_user_id';
  END IF;

  IF v_uid <> p_user_id
     AND NOT public.is_current_user_admin()
     AND NOT public.is_current_user_super_admin() THEN
    RAISE EXCEPTION 'permission_denied: can only export own data';
  END IF;

  SELECT NULLIF(trim(lower(pr.email::text)), '') INTO v_email
  FROM public.profiles pr
  WHERE pr.id = p_user_id;

  SELECT jsonb_build_object(
    'export_version', 3,
    'exported_at',   now(),
    'user_id',       p_user_id,

    'profile', (
      SELECT to_jsonb(p)
      FROM (
        SELECT id, email, display_name, role, phone, website, country,
               company_name, created_at, tos_accepted, privacy_accepted,
               deletion_requested_at
        FROM public.profiles WHERE id = p_user_id
      ) p
    ),

    'consent_log', (
      SELECT COALESCE(jsonb_agg(to_jsonb(c)), '[]'::jsonb)
      FROM (
        SELECT consent_type, version, accepted_at, ip_address, withdrawn_at, withdrawal_reason
        FROM public.consent_log WHERE user_id = p_user_id
        ORDER BY accepted_at DESC
      ) c
    ),

    'legal_acceptances', (
      SELECT COALESCE(jsonb_agg(to_jsonb(l)), '[]'::jsonb)
      FROM (
        SELECT id, document_type, document_version, accepted, ip_address, user_agent, created_at
        FROM public.legal_acceptances WHERE user_id = p_user_id
        ORDER BY created_at DESC
      ) l
    ),

    'organizations', (
      SELECT COALESCE(jsonb_agg(to_jsonb(o)), '[]'::jsonb)
      FROM (
        SELECT om.role, om.created_at AS joined_at,
               org.type AS org_type, org.id AS org_id, org.name AS org_name
        FROM public.organization_members om
        JOIN public.organizations org ON org.id = om.organization_id
        WHERE om.user_id = p_user_id
      ) o
    ),

    'messages_sent', (
      SELECT COALESCE(jsonb_agg(to_jsonb(m)), '[]'::jsonb)
      FROM (
        SELECT
          m.id,
          m.conversation_id,
          public.gdpr_export_actor_ref(m.sender_id, p_user_id) AS sender_ref,
          m.text,
          m.file_url,
          m.file_type,
          m.read_at,
          m.created_at,
          m.message_type,
          m.metadata
        FROM public.messages m
        WHERE m.sender_id = p_user_id
        ORDER BY m.created_at DESC
        LIMIT 1000
      ) m
    ),

    'messages_received', (
      SELECT COALESCE(jsonb_agg(to_jsonb(m)), '[]'::jsonb)
      FROM (
        SELECT
          m.id,
          m.conversation_id,
          public.gdpr_export_actor_ref(m.sender_id, p_user_id) AS sender_ref,
          m.text,
          m.file_url,
          m.file_type,
          m.read_at,
          m.created_at,
          m.message_type,
          m.metadata
        FROM public.messages m
        INNER JOIN public.conversations c ON c.id = m.conversation_id
        WHERE (p_user_id = ANY (c.participant_ids) OR c.guest_user_id = p_user_id)
          AND m.sender_id IS DISTINCT FROM p_user_id
        ORDER BY m.created_at DESC
        LIMIT 1000
      ) m
    ),

    'conversations', (
      SELECT COALESCE(jsonb_agg(to_jsonb(c2)), '[]'::jsonb)
      FROM (
        SELECT
          c.id,
          c.type,
          c.context_id,
          public.gdpr_export_participant_refs(c.participant_ids, p_user_id) AS participant_id_refs,
          c.title,
          c.created_at,
          c.updated_at,
          public.gdpr_export_actor_ref(c.created_by, p_user_id) AS created_by_ref,
          c.client_organization_id,
          c.agency_organization_id,
          COALESCE(c.is_archived, false) AS is_archived,
          public.gdpr_export_actor_ref(c.guest_user_id, p_user_id) AS guest_user_ref
        FROM public.conversations c
        WHERE p_user_id = ANY (c.participant_ids)
           OR c.guest_user_id = p_user_id
        ORDER BY c.updated_at DESC NULLS LAST
        LIMIT 500
      ) c2
    ),

    'recruiting_chat_threads', (
      SELECT COALESCE(jsonb_agg(to_jsonb(x)), '[]'::jsonb)
      FROM (
        SELECT DISTINCT ON (t.id)
          t.id, t.application_id, t.model_name, t.agency_id, t.organization_id,
          public.gdpr_export_actor_ref(t.created_by, p_user_id) AS created_by_ref,
          t.created_at, t.chat_type
        FROM public.recruiting_chat_threads t
        LEFT JOIN public.model_applications app ON app.id = t.application_id
        WHERE t.created_by = p_user_id
           OR app.applicant_user_id = p_user_id
        ORDER BY t.id, t.created_at DESC
      ) x
    ),

    'recruiting_chat_messages', (
      SELECT COALESCE(jsonb_agg(to_jsonb(m)), '[]'::jsonb)
      FROM (
        SELECT m.id, m.thread_id, m.from_role, m.text, m.file_url, m.file_type, m.created_at
        FROM public.recruiting_chat_messages m
        WHERE EXISTS (
          SELECT 1
          FROM public.recruiting_chat_threads t
          LEFT JOIN public.model_applications app ON app.id = t.application_id
          WHERE t.id = m.thread_id
            AND (
              t.created_by = p_user_id
              OR app.applicant_user_id = p_user_id
            )
        )
        ORDER BY m.created_at DESC
        LIMIT 2000
      ) m
    ),

    'option_requests', (
      SELECT COALESCE(jsonb_agg(to_jsonb(r)), '[]'::jsonb)
      FROM (
        SELECT
          r.id, r.client_id, r.model_id, r.agency_id, r.requested_date, r.status, r.project_id,
          r.client_name, r.model_name, r.job_description, r.proposed_price, r.agency_counter_price,
          r.client_price_status, r.final_status, r.request_type, r.currency, r.start_time, r.end_time,
          r.model_approval, r.model_approved_at, r.model_account_linked, r.booker_id,
          r.organization_id, r.agency_organization_id, r.client_organization_id,
          r.client_organization_name, r.agency_organization_name,
          r.created_by, r.agency_assignee_user_id, r.is_agency_only, r.agency_event_group_id,
          r.created_at, r.updated_at
        FROM public.option_requests r
        WHERE r.client_id = p_user_id
           OR r.created_by = p_user_id
           OR r.booker_id = p_user_id
           OR r.agency_assignee_user_id = p_user_id
           OR EXISTS (
             SELECT 1 FROM public.models mo
             WHERE mo.id = r.model_id AND mo.user_id = p_user_id
           )
        ORDER BY r.created_at DESC
        LIMIT 500
      ) r
    ),

    'option_request_messages', (
      SELECT COALESCE(jsonb_agg(to_jsonb(orm)), '[]'::jsonb)
      FROM (
        SELECT
          orm.id,
          orm.option_request_id,
          orm.from_role,
          orm.text,
          orm.booker_id,
          orm.booker_name,
          orm.visible_to_model,
          orm.created_at
        FROM public.option_request_messages orm
        INNER JOIN public.option_requests oq ON oq.id = orm.option_request_id
        WHERE public.option_request_visible_for_export_subject(oq.id, p_user_id)
          AND (
            NOT EXISTS (
              SELECT 1 FROM public.models mo
              WHERE mo.id = oq.model_id AND mo.user_id = p_user_id
            )
            OR orm.visible_to_model = true
          )
        ORDER BY orm.created_at DESC
        LIMIT 5000
      ) orm
    ),

    'option_documents', (
      SELECT COALESCE(jsonb_agg(to_jsonb(d)), '[]'::jsonb)
      FROM (
        SELECT d.id, d.option_request_id, d.uploaded_by, d.file_name, d.file_url, d.file_type, d.created_at
        FROM public.option_documents d
        INNER JOIN public.option_requests oq ON oq.id = d.option_request_id
        WHERE public.option_request_visible_for_export_subject(oq.id, p_user_id)
        ORDER BY d.created_at DESC
        LIMIT 2000
      ) d
    ),

    'model_profile', (
      SELECT COALESCE(jsonb_agg(x.row_json), '[]'::jsonb)
      FROM (
        SELECT to_jsonb(m) AS row_json
        FROM public.models m
        WHERE m.user_id = p_user_id
        ORDER BY m.created_at DESC NULLS LAST
      ) x
    ),

    'model_photos', (
      SELECT COALESCE(jsonb_agg(to_jsonb(mp)), '[]'::jsonb)
      FROM (
        SELECT
          mp.id, mp.model_id, mp.agency_id, mp.url, mp.sort_order, mp.visible,
          mp.is_visible_to_clients, mp.photo_type, mp.source, mp.api_external_id,
          mp.created_at, mp.updated_at
        FROM public.model_photos mp
        INNER JOIN public.models m ON m.id = mp.model_id AND m.user_id = p_user_id
        ORDER BY mp.created_at DESC NULLS LAST
        LIMIT 2000
      ) mp
    ),

    'client_projects', (
      SELECT COALESCE(jsonb_agg(to_jsonb(cp)), '[]'::jsonb)
      FROM (
        SELECT cp.id, cp.owner_id, cp.name, cp.organization_id, cp.created_at, cp.updated_at
        FROM public.client_projects cp
        WHERE cp.owner_id = p_user_id
           OR (
             cp.organization_id IS NOT NULL
             AND EXISTS (
               SELECT 1 FROM public.organization_members om
               WHERE om.organization_id = cp.organization_id
                 AND om.user_id = p_user_id
             )
           )
        ORDER BY cp.created_at DESC
        LIMIT 500
      ) cp
    ),

    'invitations', (
      SELECT COALESCE(jsonb_agg(to_jsonb(inv)), '[]'::jsonb)
      FROM (
        SELECT
          i.id, i.email, i.organization_id, i.role::text AS role, i.invited_by,
          i.status::text AS status, i.created_at, i.expires_at
        FROM public.invitations i
        WHERE (
            v_email IS NOT NULL AND lower(trim(i.email)) = v_email
          )
          OR i.invited_by = p_user_id
          OR EXISTS (
            SELECT 1 FROM public.organization_members om
            WHERE om.organization_id = i.organization_id
              AND om.user_id = p_user_id
          )
        ORDER BY i.created_at DESC
        LIMIT 500
      ) inv
    ),

    'booking_events', (
      SELECT COALESCE(jsonb_agg(to_jsonb(be)), '[]'::jsonb)
      FROM (
        SELECT
          be.id, be.model_id, be.client_org_id, be.agency_org_id, be.date, be.type, be.status,
          be.title, be.note, be.source_option_request_id,
          public.gdpr_export_actor_ref(be.created_by, p_user_id) AS created_by_ref,
          be.created_at, be.updated_at
        FROM public.booking_events be
        WHERE be.created_by = p_user_id
           OR EXISTS (
             SELECT 1 FROM public.models m
             WHERE m.id = be.model_id AND m.user_id = p_user_id
           )
           OR (be.client_org_id IS NOT NULL AND EXISTS (
             SELECT 1 FROM public.organization_members om
             WHERE om.organization_id = be.client_org_id AND om.user_id = p_user_id
           ))
           OR (be.agency_org_id IS NOT NULL AND EXISTS (
             SELECT 1 FROM public.organization_members om
             WHERE om.organization_id = be.agency_org_id AND om.user_id = p_user_id
           ))
        ORDER BY be.created_at DESC
        LIMIT 1000
      ) be
    ),

    'calendar_events', (
      SELECT COALESCE(jsonb_agg(to_jsonb(e)), '[]'::jsonb)
      FROM (
        SELECT
          e.id, e.owner_id, e.owner_type, e.date, e.start_time, e.end_time,
          e.title, e.color, e.note, e.organization_id,
          public.gdpr_export_actor_ref(e.created_by, p_user_id) AS created_by_ref,
          e.source_option_request_id, e.reminder_at, e.status,
          e.created_at, e.updated_at
        FROM public.user_calendar_events e
        WHERE e.owner_id = p_user_id
           OR e.created_by = p_user_id
           OR (
             e.organization_id IS NOT NULL
             AND EXISTS (
               SELECT 1
               FROM public.organization_members om
               WHERE om.user_id = p_user_id
                 AND om.organization_id = e.organization_id
             )
           )
        ORDER BY e.created_at DESC
        LIMIT 500
      ) e
    ),

    'calendar_entries', (
      SELECT COALESCE(jsonb_agg(to_jsonb(ce)), '[]'::jsonb)
      FROM (
        SELECT
          ce.id, ce.model_id, ce.date, ce.status, ce.title, ce.entry_type, ce.option_request_id,
          ce.created_by_agency, ce.client_name, ce.created_at
        FROM public.calendar_entries ce
        WHERE EXISTS (
          SELECT 1 FROM public.models m
          WHERE m.id = ce.model_id AND m.user_id = p_user_id
        )
        OR EXISTS (
          SELECT 1 FROM public.option_requests orq
          WHERE orq.id = ce.option_request_id
            AND (
              orq.client_id = p_user_id
              OR orq.created_by = p_user_id
              OR orq.booker_id = p_user_id
              OR orq.agency_assignee_user_id = p_user_id
              OR EXISTS (SELECT 1 FROM public.models mo WHERE mo.id = orq.model_id AND mo.user_id = p_user_id)
            )
        )
        ORDER BY ce.created_at DESC NULLS LAST
        LIMIT 500
      ) ce
    ),

    'notifications', (
      SELECT COALESCE(jsonb_agg(to_jsonb(n)), '[]'::jsonb)
      FROM (
        SELECT id, type, title, message, metadata, is_read, organization_id, created_at
        FROM public.notifications
        WHERE user_id = p_user_id
        ORDER BY created_at DESC
        LIMIT 1000
      ) n
    ),

    'activity_logs', (
      SELECT COALESCE(jsonb_agg(to_jsonb(a)), '[]'::jsonb)
      FROM (
        SELECT id, org_id, user_id, action_type, entity_id, created_at
        FROM public.activity_logs
        WHERE user_id = p_user_id
        ORDER BY created_at DESC
        LIMIT 1000
      ) a
    ),

    'audit_trail', (
      SELECT COALESCE(jsonb_agg(to_jsonb(a)), '[]'::jsonb)
      FROM (
        SELECT action_type, entity_type, entity_id, created_at, source
        FROM public.audit_trail
        WHERE user_id = p_user_id
           OR entity_id = p_user_id
        ORDER BY created_at DESC
        LIMIT 500
      ) a
    ),

    'image_rights_confirmations', (
      SELECT COALESCE(jsonb_agg(to_jsonb(i)), '[]'::jsonb)
      FROM (
        SELECT model_id, confirmed_at, ip_address
        FROM public.image_rights_confirmations
        WHERE user_id = p_user_id
        ORDER BY confirmed_at DESC
      ) i
    ),

    'push_tokens', (
      SELECT COALESCE(jsonb_agg(to_jsonb(pt)), '[]'::jsonb)
      FROM (
        SELECT id, platform, is_active, token, created_at, updated_at
        FROM public.push_tokens
        WHERE user_id = p_user_id
        ORDER BY created_at DESC
      ) pt
    )
  ) INTO v_result;

  PERFORM public.log_audit_action(
    NULL,
    'data_exported',
    'profile',
    p_user_id,
    NULL,
    jsonb_build_object('requested_by', v_uid, 'exported_user', p_user_id, 'export_version', 3),
    NULL,
    'api'
  );

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.export_user_data(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.export_user_data(UUID) TO authenticated;

-- ─── Informational list for ops / reviews ───────────────────────────────────

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
    'option_request_messages',
    'option_documents',
    'models',
    'model_photos',
    'client_projects',
    'invitations',
    'booking_events',
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
  'Informational JSON list of user-data tables covered by export_user_data (v3). '
  'Update when export_user_data is extended. Not a security boundary.';

COMMENT ON FUNCTION public.export_user_data(uuid) IS
  'GDPR Art. 15/20 — JSONB export (v3). SECURITY DEFINER + row_security=off. '
  'Adds option_request_messages, option_documents, model_profile, model_photos, client_projects, '
  'invitations (no token), booking_events; org_name on memberships; subject-scoped option visibility '
  '(option_request_visible_for_export_subject); pseudonymized B2B participant/sender refs; '
  'COALESCE empty arrays; guest_user_id conversation coverage. '
  'Logged via log_audit_action (data_exported, source=api). '
  'GUARDRAIL: new user-related tables → evaluate export_user_data + get_user_related_tables + docs/GDPR_EXPORT_TABLE_MAP.md.';
