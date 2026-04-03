-- =============================================================================
-- GDPR & Legal Compliance Migration 2026-04
-- IndexCasting — Full Compliance Enforcement
--
-- Covers:
--   PART 1  — delete_organization_data(org_id) RPC
--   PART 3  — image_rights_confirmations table + RLS
--   PART 4  — model_minor_consent table + RLS + models.is_minor column
--   PART 5  — audit_trail table + log_audit_action() RPC + extended action types
--   PART 6  — Extended security_events types (anomaly, brute_force, etc.)
--   PART 7  — Data retention cleanup: gdpr_purge_expired_deletions()
--   PART 8  — export_user_data(user_id) RPC
--
-- Idempotent: all CREATE TABLE / CREATE INDEX / CREATE POLICY wrapped with
-- IF NOT EXISTS; CREATE OR REPLACE used for functions.
-- Safe to re-run.
-- =============================================================================


-- =============================================================================
-- PART 1 — delete_organization_data(org_id)
-- Permanently purges all data belonging to an organization.
-- Callable only by the organization owner. Cascade deletes via FK or explicit.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.delete_organization_data(p_org_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid       UUID := auth.uid();
  v_role      TEXT;
  v_agency_id UUID;
  v_client_id UUID;
  v_org_type  TEXT;
BEGIN
  -- ── 1. Auth check ────────────────────────────────────────────────────────
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- Caller must be owner of this organization.
  SELECT om.role, o.type, o.agency_id, o.client_id
  INTO   v_role, v_org_type, v_agency_id, v_client_id
  FROM   public.organization_members om
  JOIN   public.organizations        o ON o.id = om.organization_id
  WHERE  om.organization_id = p_org_id
    AND  om.user_id         = v_uid;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_member_of_org';
  END IF;

  IF v_role <> 'owner' THEN
    RAISE EXCEPTION 'only_owner_can_delete_organization';
  END IF;

  -- ── 2. Audit: record the deletion request before wiping data ─────────────
  INSERT INTO public.audit_trail (
    user_id, org_id, action_type, entity_type, entity_id,
    new_data, created_at
  ) VALUES (
    v_uid, p_org_id, 'org_deleted', 'organization', p_org_id,
    jsonb_build_object('org_type', v_org_type, 'deleted_by', v_uid),
    now()
  );

  -- ── 3. Agency-specific cleanup ──────────────────────────────────────────
  IF v_org_type = 'agency' AND v_agency_id IS NOT NULL THEN
    -- Model photos
    DELETE FROM public.model_photos
    WHERE model_id IN (SELECT id FROM public.models WHERE agency_id = v_agency_id);

    -- Model minor consent records
    DELETE FROM public.model_minor_consent
    WHERE model_id IN (SELECT id FROM public.models WHERE agency_id = v_agency_id);

    -- Image rights confirmations
    DELETE FROM public.image_rights_confirmations
    WHERE model_id IN (SELECT id FROM public.models WHERE agency_id = v_agency_id);

    -- Model applications (recruiting)
    DELETE FROM public.recruiting_chat_messages
    WHERE thread_id IN (
      SELECT id FROM public.recruiting_chat_threads WHERE agency_id = v_agency_id
    );
    DELETE FROM public.recruiting_chat_threads WHERE agency_id = v_agency_id;

    DELETE FROM public.model_applications WHERE agency_id = v_agency_id;

    -- Territories
    DELETE FROM public.model_agency_territories WHERE agency_id = v_agency_id;

    -- Models (soft-ended first, then delete)
    DELETE FROM public.models WHERE agency_id = v_agency_id;

    -- Calendar entries
    DELETE FROM public.calendar_entries WHERE agency_id = v_agency_id;

    -- Agency guest links
    DELETE FROM public.guest_links WHERE agency_id = v_agency_id;

    -- Agency row itself
    DELETE FROM public.agencies WHERE id = v_agency_id;
  END IF;

  -- ── 4. Client-specific cleanup ───────────────────────────────────────────
  IF v_org_type = 'client' AND v_client_id IS NOT NULL THEN
    DELETE FROM public.client_project_models
    WHERE project_id IN (
      SELECT id FROM public.client_projects WHERE client_id = v_client_id
    );
    DELETE FROM public.client_projects WHERE client_id = v_client_id;

    DELETE FROM public.option_request_messages
    WHERE option_request_id IN (
      SELECT id FROM public.option_requests WHERE client_id = v_client_id
    );
    DELETE FROM public.option_documents
    WHERE option_request_id IN (
      SELECT id FROM public.option_requests WHERE client_id = v_client_id
    );
    DELETE FROM public.option_requests WHERE client_id = v_client_id;

    DELETE FROM public.client_agency_connections WHERE client_id = v_client_id;

    DELETE FROM public.clients WHERE id = v_client_id;
  END IF;

  -- ── 5. Shared cleanup ────────────────────────────────────────────────────
  -- Conversations (org-scoped)
  DELETE FROM public.messages
  WHERE conversation_id IN (
    SELECT id FROM public.conversations
    WHERE client_organization_id = p_org_id
       OR agency_organization_id = p_org_id
  );
  DELETE FROM public.conversations
  WHERE client_organization_id = p_org_id
     OR agency_organization_id = p_org_id;

  -- Invitations
  DELETE FROM public.invitations WHERE organization_id = p_org_id;

  -- Subscriptions
  DELETE FROM public.organization_subscriptions WHERE organization_id = p_org_id;

  -- Members: soft-delete profiles before removing membership
  UPDATE public.profiles
  SET deletion_requested_at = now()
  WHERE id IN (
    SELECT user_id FROM public.organization_members WHERE organization_id = p_org_id
  )
  AND deletion_requested_at IS NULL;

  DELETE FROM public.organization_members WHERE organization_id = p_org_id;

  -- Organization row
  DELETE FROM public.organizations WHERE id = p_org_id;
END;
$$;

REVOKE ALL    ON FUNCTION public.delete_organization_data(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_organization_data(UUID) TO authenticated;

COMMENT ON FUNCTION public.delete_organization_data(UUID) IS
  'GDPR/AGB: Permanently deletes all data for an organization. '
  'Callable by the organization owner only. Cascades models, photos, '
  'conversations, option_requests, members, and related data.';


-- =============================================================================
-- PART 3 — image_rights_confirmations
-- Stores the timestamp and actor when image rights are confirmed at upload.
-- Upload is rejected in the application layer if no confirmation row exists.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.image_rights_confirmations (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  model_id     UUID        REFERENCES public.models(id)       ON DELETE CASCADE,
  session_key  TEXT,          -- optional: ties to a specific upload session
  ip_address   TEXT,
  user_agent   TEXT,
  confirmed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS irc_user_id_idx    ON public.image_rights_confirmations (user_id);
CREATE INDEX IF NOT EXISTS irc_model_id_idx   ON public.image_rights_confirmations (model_id);
CREATE INDEX IF NOT EXISTS irc_confirmed_idx  ON public.image_rights_confirmations (confirmed_at DESC);

ALTER TABLE public.image_rights_confirmations ENABLE ROW LEVEL SECURITY;

-- Insert: only authenticated users inserting their own record
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'image_rights_confirmations'
      AND policyname = 'irc_insert_own'
  ) THEN
    CREATE POLICY irc_insert_own
      ON public.image_rights_confirmations FOR INSERT
      TO authenticated
      WITH CHECK (user_id = auth.uid());
  END IF;
END $$;

-- Select: only own records (audit; admin reads via service_role)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'image_rights_confirmations'
      AND policyname = 'irc_select_own'
  ) THEN
    CREATE POLICY irc_select_own
      ON public.image_rights_confirmations FOR SELECT
      TO authenticated
      USING (user_id = auth.uid());
  END IF;
END $$;

COMMENT ON TABLE public.image_rights_confirmations IS
  'Stores proof that the uploading user confirmed image rights before upload. '
  'Required by GDPR / Urheberrecht: timestamp + user_id + model_id are immutable audit evidence.';


-- =============================================================================
-- PART 4 — model_minor_consent + models.is_minor column
-- =============================================================================

-- Add is_minor to models if not present
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'models' AND column_name = 'is_minor'
  ) THEN
    ALTER TABLE public.models ADD COLUMN is_minor BOOLEAN NOT NULL DEFAULT false;
  END IF;
END $$;

COMMENT ON COLUMN public.models.is_minor IS
  'True when the model is a minor. Requires guardian consent before any data processing or publication.';

CREATE TABLE IF NOT EXISTS public.model_minor_consent (
  id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id                  UUID        NOT NULL REFERENCES public.models(id) ON DELETE CASCADE,
  guardian_name             TEXT,
  guardian_email            TEXT,
  guardian_consent_confirmed BOOLEAN    NOT NULL DEFAULT false,
  guardian_consent_at       TIMESTAMPTZ,
  agency_confirmed          BOOLEAN     NOT NULL DEFAULT false,
  agency_confirmed_by       UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  agency_confirmed_at       TIMESTAMPTZ,
  notes                     TEXT,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS mmc_model_id_unique ON public.model_minor_consent (model_id);
CREATE INDEX IF NOT EXISTS mmc_agency_confirmed_idx ON public.model_minor_consent (agency_confirmed);

ALTER TABLE public.model_minor_consent ENABLE ROW LEVEL SECURITY;

-- Agency members can SELECT/INSERT/UPDATE minor consent for their own models
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'model_minor_consent'
      AND policyname = 'mmc_agency_access'
  ) THEN
    CREATE POLICY mmc_agency_access
      ON public.model_minor_consent
      FOR ALL
      TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM public.models m
          JOIN public.organizations o ON o.agency_id = m.agency_id
          JOIN public.organization_members om ON om.organization_id = o.id
          WHERE m.id = model_minor_consent.model_id
            AND om.user_id = auth.uid()
            AND o.type = 'agency'
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1
          FROM public.models m
          JOIN public.organizations o ON o.agency_id = m.agency_id
          JOIN public.organization_members om ON om.organization_id = o.id
          WHERE m.id = model_minor_consent.model_id
            AND om.user_id = auth.uid()
            AND o.type = 'agency'
        )
      );
  END IF;
END $$;

COMMENT ON TABLE public.model_minor_consent IS
  'Guardian consent records for minor models. Required before any model data is published '
  'or processed. Both guardian_consent_confirmed and agency_confirmed must be true before '
  'is_visible_fashion / is_visible_commercial can be set to true for this model.';


-- =============================================================================
-- PART 5 — audit_trail table
-- Comprehensive immutable audit log: bookings, price negotiations, accept/reject,
-- profile edits, admin overrides. Append-only (no UPDATE/DELETE for users).
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.audit_trail (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        REFERENCES auth.users(id)    ON DELETE SET NULL,
  org_id      UUID        REFERENCES public.organizations(id) ON DELETE SET NULL,
  action_type TEXT        NOT NULL,
  entity_type TEXT,
  entity_id   UUID,
  old_data    JSONB,
  new_data    JSONB,
  ip_address  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS at_user_id_idx    ON public.audit_trail (user_id);
CREATE INDEX IF NOT EXISTS at_org_id_idx     ON public.audit_trail (org_id);
CREATE INDEX IF NOT EXISTS at_action_idx     ON public.audit_trail (action_type);
CREATE INDEX IF NOT EXISTS at_entity_idx     ON public.audit_trail (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS at_created_idx    ON public.audit_trail (created_at DESC);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_schema = 'public' AND constraint_name = 'audit_trail_action_type_check'
  ) THEN
    ALTER TABLE public.audit_trail
      ADD CONSTRAINT audit_trail_action_type_check CHECK (action_type IN (
        -- GDPR
        'user_deleted', 'user_deletion_requested', 'user_deletion_cancelled',
        'org_deleted', 'data_exported',
        -- Bookings
        'booking_created', 'booking_confirmed', 'booking_cancelled',
        -- Price negotiations
        'option_sent', 'option_price_proposed', 'option_price_countered',
        'option_confirmed', 'option_rejected',
        -- Recruiting / Casting
        'application_accepted', 'application_rejected',
        -- Profile edits
        'profile_updated', 'model_created', 'model_updated', 'model_removed',
        'model_visibility_changed',
        -- Image rights
        'image_rights_confirmed', 'image_uploaded', 'image_deleted',
        -- Minor consent
        'minor_flagged', 'minor_guardian_consent', 'minor_agency_confirmed',
        -- Team
        'member_invited', 'member_removed', 'member_role_changed',
        -- Admin
        'admin_override', 'admin_profile_updated', 'admin_subscription_changed',
        -- Security
        'login_failed', 'permission_denied', 'suspicious_activity'
      ));
  END IF;
END $$;

ALTER TABLE public.audit_trail ENABLE ROW LEVEL SECURITY;

-- INSERT: authenticated users can log their own actions
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'audit_trail'
      AND policyname = 'at_insert_own'
  ) THEN
    CREATE POLICY at_insert_own
      ON public.audit_trail FOR INSERT
      TO authenticated
      WITH CHECK (user_id = auth.uid());
  END IF;
END $$;

-- SELECT: org members can read their org's audit trail
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'audit_trail'
      AND policyname = 'at_select_org_members'
  ) THEN
    CREATE POLICY at_select_org_members
      ON public.audit_trail FOR SELECT
      TO authenticated
      USING (
        org_id IS NOT NULL AND
        EXISTS (
          SELECT 1 FROM public.organization_members
          WHERE organization_id = audit_trail.org_id
            AND user_id = auth.uid()
        )
      );
  END IF;
END $$;

COMMENT ON TABLE public.audit_trail IS
  'Immutable compliance audit trail. Append-only for users. '
  'Admin reads via service_role. Covers GDPR, bookings, negotiations, '
  'profile edits, image rights and admin overrides.';


-- ── log_audit_action() RPC ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.log_audit_action(
  p_org_id      UUID,
  p_action_type TEXT,
  p_entity_type TEXT  DEFAULT NULL,
  p_entity_id   UUID  DEFAULT NULL,
  p_old_data    JSONB DEFAULT NULL,
  p_new_data    JSONB DEFAULT NULL,
  p_ip_address  TEXT  DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO public.audit_trail (
    user_id, org_id, action_type, entity_type, entity_id,
    old_data, new_data, ip_address
  ) VALUES (
    auth.uid(), p_org_id, p_action_type, p_entity_type, p_entity_id,
    p_old_data, p_new_data, p_ip_address
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE ALL    ON FUNCTION public.log_audit_action(UUID, TEXT, TEXT, UUID, JSONB, JSONB, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_audit_action(UUID, TEXT, TEXT, UUID, JSONB, JSONB, TEXT) TO authenticated;

COMMENT ON FUNCTION public.log_audit_action IS
  'SECURITY DEFINER RPC: writes an immutable audit_trail entry. '
  'user_id is always auth.uid() (cannot be spoofed). '
  'Safe to call fire-and-forget from application code.';


-- =============================================================================
-- PART 6 — Extend security_events allowed types (incident response)
-- =============================================================================

DO $$ BEGIN
  -- Drop the existing check constraint and recreate with extended set
  IF EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_schema = 'public' AND constraint_name = 'security_events_type_check'
  ) THEN
    ALTER TABLE public.security_events
      DROP CONSTRAINT security_events_type_check;
  END IF;

  ALTER TABLE public.security_events
    ADD CONSTRAINT security_events_type_check
      CHECK (type IN (
        -- Existing
        'xss_attempt',
        'invalid_url',
        'file_rejected',
        'mime_mismatch',
        'extension_mismatch',
        'rate_limit',
        'large_payload',
        'magic_bytes_fail',
        'unsafe_content',
        -- New: incident response
        'brute_force',
        'anomalous_access',
        'cross_org_attempt',
        'privilege_escalation_attempt',
        'suspicious_export',
        'unauthorized_deletion_attempt',
        'admin_anomaly',
        'guest_link_abuse'
      ));
END $$;

-- Allow authenticated users to also insert (without requiring user_id not null)
-- Already covered by existing policy security_events_insert_own.
-- Additional: allow anonymous insert for pre-auth events (e.g. brute force on login)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'security_events'
      AND policyname = 'security_events_insert_anon'
  ) THEN
    CREATE POLICY security_events_insert_anon
      ON public.security_events FOR INSERT
      TO anon
      WITH CHECK (user_id IS NULL);
  END IF;
END $$;


-- =============================================================================
-- PART 7 — Data retention: gdpr_purge_expired_deletions()
-- Purges auth users whose deletion_requested_at is older than 30 days.
-- Designed to be called by a pg_cron job or Edge Function cron.
-- Also: cleanup of old audit_trail entries (> 7 years per HGB).
-- Also: cleanup of old security_events (> 2 years).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.gdpr_purge_expired_deletions()
RETURNS TABLE (purged_user_id UUID, purged_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID;
BEGIN
  -- Return all user IDs past the 30-day grace period.
  -- The Edge Function (delete-user) handles auth.admin.deleteUser().
  -- Here we anonymize the profile data to ensure no orphan PII remains.
  FOR v_uid IN
    SELECT id FROM public.profiles
    WHERE deletion_requested_at IS NOT NULL
      AND deletion_requested_at < now() - INTERVAL '30 days'
  LOOP
    -- Anonymize profile (replace PII with placeholder)
    UPDATE public.profiles SET
      email              = 'deleted-' || v_uid || '@deleted.invalid',
      display_name       = '[Deleted User]',
      phone              = NULL,
      website            = NULL,
      country            = NULL,
      company_name       = NULL,
      verification_email = NULL
    WHERE id = v_uid;

    -- Remove from any remaining org memberships
    DELETE FROM public.organization_members WHERE user_id = v_uid;

    -- Log the purge for compliance evidence
    INSERT INTO public.audit_trail (
      user_id, org_id, action_type, entity_type, entity_id, new_data, created_at
    ) VALUES (
      NULL, NULL, 'user_deleted', 'profile', v_uid,
      jsonb_build_object('purged_at', now(), 'method', 'gdpr_purge_expired_deletions'),
      now()
    );

    purged_user_id := v_uid;
    purged_at      := now();
    RETURN NEXT;
  END LOOP;
END;
$$;

-- Only callable by service_role / pg_cron (not exposed to authenticated users)
REVOKE ALL ON FUNCTION public.gdpr_purge_expired_deletions() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.gdpr_purge_expired_deletions() FROM authenticated;

COMMENT ON FUNCTION public.gdpr_purge_expired_deletions() IS
  'GDPR Data Retention: anonymizes profiles past the 30-day grace period. '
  'Call from a pg_cron job (daily) or an Edge Function cron. '
  'The calling Edge Function must then also call auth.admin.deleteUser() '
  'for each returned purged_user_id to fully remove the auth record.';


-- ── Retention cleanup: old audit_trail entries (7-year retention = HGB § 257)
CREATE OR REPLACE FUNCTION public.gdpr_purge_old_audit_trail()
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count BIGINT;
BEGIN
  DELETE FROM public.audit_trail
  WHERE created_at < now() - INTERVAL '7 years';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.gdpr_purge_old_audit_trail() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.gdpr_purge_old_audit_trail() FROM authenticated;


-- ── Retention cleanup: security_events (2-year retention)
CREATE OR REPLACE FUNCTION public.gdpr_purge_old_security_events()
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count BIGINT;
BEGIN
  DELETE FROM public.security_events
  WHERE created_at < now() - INTERVAL '2 years';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.gdpr_purge_old_security_events() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.gdpr_purge_old_security_events() FROM authenticated;


-- =============================================================================
-- PART 8 — export_user_data(user_id) — GDPR Art. 20 Data Portability
-- Returns all personal data for a user as JSONB.
-- Callable only by the user themselves or a super_admin (service_role).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.export_user_data(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid         UUID := auth.uid();
  v_is_admin    BOOLEAN;
  v_result      JSONB;
BEGIN
  -- ── Auth: only own data or super_admin ──────────────────────────────────
  SELECT COALESCE(is_super_admin, false) INTO v_is_admin
  FROM public.profiles WHERE id = v_uid;

  IF v_uid <> p_user_id AND NOT COALESCE(v_is_admin, false) THEN
    RAISE EXCEPTION 'permission_denied: can only export own data';
  END IF;

  -- ── Collect all PII ──────────────────────────────────────────────────────
  SELECT jsonb_build_object(
    'exported_at',   now(),
    'user_id',       p_user_id,

    -- Profile
    'profile', (
      SELECT row_to_json(p)::JSONB
      FROM (
        SELECT id, email, display_name, role, phone, website, country,
               company_name, created_at, tos_accepted, privacy_accepted,
               deletion_requested_at
        FROM public.profiles WHERE id = p_user_id
      ) p
    ),

    -- Consent log
    'consent_log', (
      SELECT jsonb_agg(row_to_json(c))
      FROM (
        SELECT consent_type, version, accepted_at, ip_address
        FROM public.consent_log WHERE user_id = p_user_id
        ORDER BY accepted_at DESC
      ) c
    ),

    -- Organization memberships
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

    -- Messages (sender)
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

    -- Option requests (if client)
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

    -- Calendar events
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

    -- Audit trail (own actions)
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

    -- Image rights confirmations
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

  -- Log the export itself (compliance evidence)
  INSERT INTO public.audit_trail (
    user_id, org_id, action_type, entity_type, entity_id, new_data, created_at
  ) VALUES (
    v_uid, NULL, 'data_exported', 'profile', p_user_id,
    jsonb_build_object('requested_by', v_uid, 'exported_user', p_user_id),
    now()
  );

  RETURN v_result;
END;
$$;

REVOKE ALL    ON FUNCTION public.export_user_data(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.export_user_data(UUID) TO authenticated;

COMMENT ON FUNCTION public.export_user_data(UUID) IS
  'GDPR Art. 20 — Data Portability: returns all personal data for a user as JSONB. '
  'Callable only by the user themselves or a super_admin. '
  'The export itself is logged in audit_trail for compliance evidence.';


-- =============================================================================
-- PART 2 — Cross-org guard: log cross-org access attempts
-- Adds a DB-level trigger on organization_members to detect role escalation
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fn_guard_org_member_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_org UUID;
BEGIN
  -- Detect if the caller is inserting someone into a different org than their own
  SELECT om.organization_id INTO v_caller_org
  FROM public.organization_members om
  WHERE om.user_id = auth.uid()
  LIMIT 1;

  IF v_caller_org IS NOT NULL AND NEW.organization_id <> v_caller_org THEN
    -- Log a security event
    INSERT INTO public.security_events (user_id, org_id, type, metadata, created_at)
    VALUES (
      auth.uid(),
      v_caller_org,
      'cross_org_attempt',
      jsonb_build_object(
        'target_org', NEW.organization_id,
        'target_user', NEW.user_id,
        'action', 'member_insert_cross_org'
      ),
      now()
    );
    RAISE EXCEPTION 'cross_org_member_insert_denied';
  END IF;

  RETURN NEW;
END;
$$;

-- Attach trigger only if not already present
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_guard_org_member_insert'
      AND tgrelid = 'public.organization_members'::regclass
  ) THEN
    CREATE TRIGGER trg_guard_org_member_insert
      BEFORE INSERT ON public.organization_members
      FOR EACH ROW EXECUTE FUNCTION public.fn_guard_org_member_insert();
  END IF;
END $$;

COMMENT ON FUNCTION public.fn_guard_org_member_insert() IS
  'Security: prevents cross-org member injection. '
  'Logs a security_event and raises an exception if a user attempts to '
  'add a member to an org they do not belong to.';


-- =============================================================================
-- PART 9 — Verify guest_links rate limit exists (read-only assertion)
-- =============================================================================

DO $$
BEGIN
  -- If the table doesn't exist we'll get a warning, not an error.
  -- The actual rate-limit logic is in migration_guest_link_rate_limit.sql.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'guest_links'
  ) THEN
    RAISE WARNING 'guest_links table not found — ensure migration_guest_link_rate_limit.sql was applied';
  END IF;
END $$;


-- =============================================================================
-- Final verification queries (informational — do not abort on result)
-- =============================================================================

SELECT
  'audit_trail'                 AS "table",
  count(*)::TEXT                AS "rows"
FROM public.audit_trail
UNION ALL
SELECT
  'image_rights_confirmations'  AS "table",
  count(*)::TEXT                AS "rows"
FROM public.image_rights_confirmations
UNION ALL
SELECT
  'model_minor_consent'         AS "table",
  count(*)::TEXT                AS "rows"
FROM public.model_minor_consent
UNION ALL
SELECT
  'security_events'             AS "table",
  count(*)::TEXT                AS "rows"
FROM public.security_events;
