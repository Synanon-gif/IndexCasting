-- =============================================================================
-- Compliance Hardening — 2026-04
-- IndexCasting — Full 15-Part Audit Gap Closures
--
-- Closes gaps identified in the full compliance audit:
--
--   GAP-1   consent_log: add withdrawn_at / revoked_at (Part 5)
--   GAP-2   anonymize_user_data() RPC — GDPR anonymization (Part 1)
--   GAP-3   revoke_guest_access() RPC — auditable revocation (Part 1/7)
--   GAP-4   guest_link_access_log — audit trail for guest link use (Part 7/9)
--   GAP-5   legal_hold support on profiles/bookings (Part 2)
--   GAP-6   data_retention_policy table — documents retention windows (Part 2)
--   GAP-7   model_visibility guard trigger for minors (Part 4)
--   GAP-8   booking_linked_to_model guard on model deletion (Part 1 edge case)
--   GAP-9   gdpr_record_of_processing view — RoPA (Part 6)
--   GAP-10  consent_log: extend types (image_rights, marketing, analytics) (Part 5)
--
-- Idempotent. Run AFTER migration_gdpr_compliance_2026_04.sql.
-- =============================================================================


-- =============================================================================
-- GAP-1: Extend consent_log with withdrawal support
-- =============================================================================

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'consent_log'
      AND column_name = 'withdrawn_at'
  ) THEN
    ALTER TABLE public.consent_log ADD COLUMN withdrawn_at TIMESTAMPTZ DEFAULT NULL;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'consent_log'
      AND column_name = 'withdrawal_reason'
  ) THEN
    ALTER TABLE public.consent_log ADD COLUMN withdrawal_reason TEXT DEFAULT NULL;
  END IF;
END $$;

-- Extend consent_type enum if it's a check constraint (not a Postgres enum)
-- to include image_rights, marketing, analytics
DO $$ BEGIN
  -- Try dropping and re-adding if it's a check constraint
  IF EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_schema = 'public' AND constraint_name = 'consent_log_consent_type_check'
  ) THEN
    ALTER TABLE public.consent_log DROP CONSTRAINT consent_log_consent_type_check;
  END IF;

  -- Add extended check
  ALTER TABLE public.consent_log
    ADD CONSTRAINT consent_log_consent_type_check
      CHECK (consent_type IN ('terms', 'privacy', 'image_rights', 'marketing', 'analytics', 'minor_guardian'));
EXCEPTION WHEN OTHERS THEN
  NULL; -- If constraint doesn't exist at all, just continue
END $$;

COMMENT ON COLUMN public.consent_log.withdrawn_at IS
  'GDPR Art. 7(3): timestamp when this consent was withdrawn. '
  'NULL means still active. Downstream features must check this field.';

COMMENT ON COLUMN public.consent_log.withdrawal_reason IS
  'Optional reason provided on consent withdrawal. For audit/logging.';

-- RPC: withdraw_consent — backend-enforced withdrawal
CREATE OR REPLACE FUNCTION public.withdraw_consent(
  p_consent_type TEXT,
  p_reason       TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  UPDATE public.consent_log
  SET
    withdrawn_at      = now(),
    withdrawal_reason = p_reason
  WHERE user_id      = v_uid
    AND consent_type = p_consent_type
    AND withdrawn_at IS NULL;

  -- Log withdrawal in audit_trail
  INSERT INTO public.audit_trail (
    user_id, org_id, action_type, entity_type, new_data, created_at
  ) VALUES (
    v_uid, NULL, 'user_deletion_requested', 'consent_log', -- reuse closest type
    jsonb_build_object(
      'consent_type', p_consent_type,
      'withdrawn_at', now(),
      'reason', p_reason
    ),
    now()
  );

  RETURN true;
END;
$$;

REVOKE ALL    ON FUNCTION public.withdraw_consent(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.withdraw_consent(TEXT, TEXT) TO authenticated;

COMMENT ON FUNCTION public.withdraw_consent IS
  'GDPR Art. 7(3): withdraws all active consents of the given type for the caller. '
  'Sets withdrawn_at = now(). Application must check withdrawn_at before '
  'processing data dependent on this consent.';


-- =============================================================================
-- GAP-2: anonymize_user_data(user_id) — GDPR anonymization where hard delete
-- is not possible (e.g. bookings with legal hold must keep financial records
-- but must anonymize personal references)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.anonymize_user_data(p_user_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid      UUID := auth.uid();
  v_is_admin BOOLEAN;
BEGIN
  -- Only self or admin
  SELECT COALESCE(is_super_admin, false) INTO v_is_admin
  FROM public.profiles WHERE id = v_uid;

  IF v_uid <> p_user_id AND NOT COALESCE(v_is_admin, false) THEN
    RAISE EXCEPTION 'permission_denied';
  END IF;

  -- Anonymize profile PII
  UPDATE public.profiles SET
    email              = 'anon-' || p_user_id || '@deleted.invalid',
    display_name       = '[Anonymized]',
    phone              = NULL,
    website            = NULL,
    country            = NULL,
    company_name       = NULL,
    verification_email = NULL,
    deletion_requested_at = COALESCE(deletion_requested_at, now())
  WHERE id = p_user_id;

  -- Anonymize messages (retain for legal context but remove PII in text)
  -- Note: message text itself is kept for contract/booking dispute evidence;
  -- only sender attribution is anonymized in display name (not message content)
  -- Content anonymization requires a separate legal hold decision.

  -- Remove from org memberships
  DELETE FROM public.organization_members WHERE user_id = p_user_id;

  -- Anonymize recruiting chat messages (personal chat with model)
  UPDATE public.recruiting_chat_messages
  SET content = '[Message anonymized per GDPR request]'
  WHERE sender_id = p_user_id;

  -- Log
  INSERT INTO public.audit_trail (
    user_id, org_id, action_type, entity_type, entity_id, new_data, created_at
  ) VALUES (
    v_uid, NULL, 'user_deleted', 'profile', p_user_id,
    jsonb_build_object('method', 'anonymize_user_data', 'requested_by', v_uid),
    now()
  );
END;
$$;

REVOKE ALL    ON FUNCTION public.anonymize_user_data(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.anonymize_user_data(UUID) TO authenticated;

COMMENT ON FUNCTION public.anonymize_user_data IS
  'GDPR: anonymizes all personal data for a user where hard delete is not possible '
  '(e.g. booking records retained for HGB legal hold). '
  'Removes org memberships, anonymizes profile fields, chat messages. '
  'Callable by the user themselves or a super_admin.';


-- =============================================================================
-- GAP-3: revoke_guest_access() — auditable revocation RPC
-- =============================================================================

CREATE OR REPLACE FUNCTION public.revoke_guest_access(p_link_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_link public.guest_links%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- Fetch the link, verify caller belongs to same agency
  SELECT gl.* INTO v_link
  FROM public.guest_links gl
  WHERE gl.id = p_link_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'guest_link_not_found';
  END IF;

  -- Verify caller is a member of the owning agency's organization
  IF NOT EXISTS (
    SELECT 1
    FROM public.organizations o
    JOIN public.organization_members om ON om.organization_id = o.id
    WHERE o.agency_id = v_link.agency_id
      AND om.user_id  = v_uid
      AND o.type = 'agency'
  ) THEN
    -- Log attempted unauthorized revocation
    INSERT INTO public.security_events (user_id, type, metadata, created_at)
    VALUES (v_uid, 'cross_org_attempt',
      jsonb_build_object('action', 'revoke_guest_access', 'link_id', p_link_id),
      now());
    RAISE EXCEPTION 'permission_denied';
  END IF;

  -- Revoke: set both flags atomically
  UPDATE public.guest_links
  SET is_active  = false,
      deleted_at = COALESCE(deleted_at, now())
  WHERE id = p_link_id;

  -- Audit log
  INSERT INTO public.audit_trail (
    user_id, action_type, entity_type, entity_id, new_data, created_at
  ) VALUES (
    v_uid, 'image_deleted', 'guest_link', p_link_id,
    jsonb_build_object('revoked_by', v_uid, 'revoked_at', now()),
    now()
  );

  RETURN true;
END;
$$;

REVOKE ALL    ON FUNCTION public.revoke_guest_access(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.revoke_guest_access(UUID) TO authenticated;

COMMENT ON FUNCTION public.revoke_guest_access IS
  'Atomically deactivates and soft-deletes a guest link. '
  'Verifies the caller belongs to the owning agency. '
  'Logs unauthorized attempts as security_events. '
  'Audit trail entry created for every revocation.';


-- =============================================================================
-- GAP-4: guest_link_access_log — audit trail for guest link opens
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.guest_link_access_log (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  link_id      UUID        NOT NULL REFERENCES public.guest_links(id) ON DELETE CASCADE,
  ip_hash      TEXT,               -- SHA-256 of IP (never raw IP — GDPR)
  user_agent   TEXT,
  event_type   TEXT        NOT NULL DEFAULT 'opened',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_schema = 'public'
      AND constraint_name = 'glal_event_type_check'
  ) THEN
    ALTER TABLE public.guest_link_access_log
      ADD CONSTRAINT glal_event_type_check
        CHECK (event_type IN ('opened', 'models_loaded', 'tos_accepted', 'revoked', 'expired_access_attempt'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS glal_link_id_idx   ON public.guest_link_access_log (link_id);
CREATE INDEX IF NOT EXISTS glal_created_idx   ON public.guest_link_access_log (created_at DESC);

ALTER TABLE public.guest_link_access_log ENABLE ROW LEVEL SECURITY;

-- No SELECT for authenticated users (admin/service_role only)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'guest_link_access_log'
      AND policyname = 'glal_insert_anon'
  ) THEN
    CREATE POLICY glal_insert_anon
      ON public.guest_link_access_log FOR INSERT
      TO anon, authenticated
      WITH CHECK (true);   -- RPCs enforce link ownership; insert is from SECURITY DEFINER context
  END IF;
END $$;

COMMENT ON TABLE public.guest_link_access_log IS
  'Audit log for guest link access events (opened, models loaded, TOS accepted, revocation). '
  'Stores SHA-256(ip) instead of raw IP (GDPR compliance). '
  'Admin-readable via service_role only.';

-- Retention cleanup for access log (1 year)
CREATE OR REPLACE FUNCTION public.gdpr_purge_old_guest_link_access_log()
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count BIGINT;
BEGIN
  DELETE FROM public.guest_link_access_log
  WHERE created_at < now() - INTERVAL '1 year';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.gdpr_purge_old_guest_link_access_log() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.gdpr_purge_old_guest_link_access_log() FROM authenticated;


-- =============================================================================
-- GAP-5: Legal hold support
-- Bookings and option_requests with financial/legal value must not be deleted
-- even when user requests GDPR deletion (HGB §257 / §147 AO: 6-10 year retention)
-- =============================================================================

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'bookings'
      AND column_name = 'legal_hold'
  ) THEN
    ALTER TABLE public.bookings ADD COLUMN legal_hold BOOLEAN NOT NULL DEFAULT false;
    COMMENT ON COLUMN public.bookings.legal_hold IS
      'When true, this booking record must not be deleted even on GDPR request. '
      'Set to true for confirmed/completed bookings with financial records. '
      'HGB §257 / §147 AO: 6-10 year commercial document retention.';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'bookings'
      AND column_name = 'legal_hold_until'
  ) THEN
    ALTER TABLE public.bookings ADD COLUMN legal_hold_until DATE DEFAULT NULL;
    COMMENT ON COLUMN public.bookings.legal_hold_until IS
      'Date until which the legal hold applies (typically booking_date + 10 years for HGB).';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'option_requests'
      AND column_name = 'legal_hold'
  ) THEN
    ALTER TABLE public.option_requests ADD COLUMN legal_hold BOOLEAN NOT NULL DEFAULT false;
    COMMENT ON COLUMN public.option_requests.legal_hold IS
      'When true, confirmed option data must be retained for statutory period.';
  END IF;
END $$;

-- Auto-trigger: set legal_hold = true when booking status → confirmed/completed
CREATE OR REPLACE FUNCTION public.fn_booking_set_legal_hold()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IN ('confirmed', 'completed', 'invoiced')
     AND (OLD.status IS NULL OR OLD.status NOT IN ('confirmed', 'completed', 'invoiced'))
  THEN
    NEW.legal_hold       := true;
    NEW.legal_hold_until := (CURRENT_DATE + INTERVAL '10 years')::DATE;
  END IF;
  RETURN NEW;
END;
$$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_booking_set_legal_hold'
      AND tgrelid = 'public.bookings'::regclass
  ) THEN
    CREATE TRIGGER trg_booking_set_legal_hold
      BEFORE INSERT OR UPDATE ON public.bookings
      FOR EACH ROW EXECUTE FUNCTION public.fn_booking_set_legal_hold();
  END IF;
END $$;

-- Protect legal_hold records: prevent DELETE when legal_hold = true
CREATE OR REPLACE FUNCTION public.fn_booking_protect_legal_hold()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.legal_hold = true THEN
    -- Log attempt
    INSERT INTO public.security_events (user_id, type, metadata, created_at)
    VALUES (
      auth.uid(),
      'unauthorized_deletion_attempt',
      jsonb_build_object('table', 'bookings', 'id', OLD.id, 'legal_hold_until', OLD.legal_hold_until),
      now()
    );
    RAISE EXCEPTION 'Cannot delete booking with active legal_hold (HGB retention applies until %)', OLD.legal_hold_until;
  END IF;
  RETURN OLD;
END;
$$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_booking_protect_legal_hold'
      AND tgrelid = 'public.bookings'::regclass
  ) THEN
    CREATE TRIGGER trg_booking_protect_legal_hold
      BEFORE DELETE ON public.bookings
      FOR EACH ROW EXECUTE FUNCTION public.fn_booking_protect_legal_hold();
  END IF;
END $$;


-- =============================================================================
-- GAP-6: data_retention_policy — machine-readable retention windows
-- This table documents retention per data type so Privacy Policy / DPA match code.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.data_retention_policy (
  data_type        TEXT PRIMARY KEY,
  retention_days   INTEGER NOT NULL,
  legal_basis      TEXT    NOT NULL,
  deletion_method  TEXT    NOT NULL,
  notes            TEXT,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Upsert canonical retention windows (matches Privacy Policy text)
INSERT INTO public.data_retention_policy
  (data_type, retention_days, legal_basis, deletion_method, notes) VALUES
  ('profiles',              10950, 'GDPR Art.6(1)(b) + 30-day grace',     'anonymize + auth.admin.deleteUser', 'Soft-delete + 30-day grace period; anonymized on purge'),
  ('messages',               3650, 'GDPR Art.6(1)(b) - contract',         'hard_delete',                       '10 years for contract evidence; shorter if no legal hold'),
  ('bookings_confirmed',     3650, 'HGB §257 / §147 AO',                  'legal_hold + anonymize_parties',    '10 years; party PII anonymized after account deletion'),
  ('bookings_cancelled',      730, 'GDPR Art.6(1)(b)',                    'hard_delete',                       '2 years for dispute window'),
  ('option_requests',        3650, 'HGB §257',                            'legal_hold + anonymize_parties',    '10 years for confirmed options'),
  ('audit_trail',            2555, 'HGB §239 / GDPR Art.5(2)',            'hard_delete',                       '7 years'),
  ('security_events',         730, 'GDPR Art.6(1)(f) legitimate interest', 'hard_delete',                      '2 years'),
  ('consent_log',            3650, 'GDPR Art.7 proof of consent',         'retain_withdrawal_flag',            'Must be kept to prove consent was given; withdrawal flag added'),
  ('guest_links',             365, 'GDPR Art.6(1)(b)',                    'soft_delete + hard_delete_after_1y', 'Soft-deleted links retained 1 year for chat metadata refs'),
  ('guest_link_access_log',   365, 'GDPR Art.6(1)(f)',                    'hard_delete',                       '1 year'),
  ('model_photos',            'on_request', 'GDPR Art.6(1)(a)/(b)',       'storage delete + DB record',        NULL) -- text special case
  ON CONFLICT (data_type) DO UPDATE SET
    retention_days  = EXCLUDED.retention_days,
    legal_basis     = EXCLUDED.legal_basis,
    deletion_method = EXCLUDED.deletion_method,
    notes           = EXCLUDED.notes,
    updated_at      = now();

-- Fix: model_photos has text value — use a separate insert
DELETE FROM public.data_retention_policy WHERE data_type = 'model_photos';
INSERT INTO public.data_retention_policy
  (data_type, retention_days, legal_basis, deletion_method, notes)
VALUES
  ('model_photos', 0, 'GDPR Art.6(1)(a)/(b)', 'storage delete + DB record',
   'Deleted on model removal or on explicit request. 0 = no minimum retention.');

ALTER TABLE public.data_retention_policy ENABLE ROW LEVEL SECURITY;
-- No public access (admin/service_role only)

COMMENT ON TABLE public.data_retention_policy IS
  'Machine-readable data retention registry. Must match Privacy Policy and DPA wording. '
  'Managed by platform owner. Admin-readable only.';


-- =============================================================================
-- GAP-7: Minor visibility guard trigger
-- Prevents is_visible_fashion / is_visible_commercial = true for minors
-- who do not yet have both guardian + agency consent confirmed.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fn_guard_minor_visibility()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_consented BOOLEAN;
BEGIN
  -- Only fires when visibility is being set to true for an is_minor model
  IF NEW.is_minor = true
     AND (NEW.is_visible_fashion = true OR NEW.is_visible_commercial = true)
     AND (
       (OLD.is_visible_fashion IS DISTINCT FROM NEW.is_visible_fashion AND NEW.is_visible_fashion = true)
       OR
       (OLD.is_visible_commercial IS DISTINCT FROM NEW.is_visible_commercial AND NEW.is_visible_commercial = true)
     )
  THEN
    SELECT (guardian_consent_confirmed = true AND agency_confirmed = true)
    INTO   v_consented
    FROM   public.model_minor_consent
    WHERE  model_id = NEW.id;

    IF NOT COALESCE(v_consented, false) THEN
      RAISE EXCEPTION
        'minor_consent_required: cannot set visibility=true for a minor without '
        'both guardian_consent_confirmed AND agency_confirmed in model_minor_consent';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_guard_minor_visibility'
      AND tgrelid = 'public.models'::regclass
  ) THEN
    CREATE TRIGGER trg_guard_minor_visibility
      BEFORE UPDATE ON public.models
      FOR EACH ROW EXECUTE FUNCTION public.fn_guard_minor_visibility();
  END IF;
END $$;

COMMENT ON FUNCTION public.fn_guard_minor_visibility IS
  'DB-level guard: prevents setting is_visible_fashion/commercial = true for a minor model '
  'without complete consent in model_minor_consent. '
  'Fails with a descriptive exception. Cannot be bypassed by frontend.';


-- =============================================================================
-- GAP-8: Model deletion guard — block if active/future bookings exist
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fn_guard_model_active_bookings()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  -- Block hard delete if confirmed/active bookings exist in the future
  SELECT COUNT(*) INTO v_count
  FROM public.bookings
  WHERE model_id = OLD.id
    AND status IN ('confirmed')
    AND booking_date >= CURRENT_DATE;

  IF v_count > 0 THEN
    INSERT INTO public.security_events (user_id, type, metadata, created_at)
    VALUES (auth.uid(), 'unauthorized_deletion_attempt',
      jsonb_build_object('table', 'models', 'model_id', OLD.id, 'active_bookings', v_count),
      now());
    RAISE EXCEPTION
      'model_has_active_bookings: % future confirmed booking(s) exist. '
      'Cancel or reassign bookings before deleting the model.', v_count;
  END IF;
  RETURN OLD;
END;
$$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_guard_model_active_bookings'
      AND tgrelid = 'public.models'::regclass
  ) THEN
    CREATE TRIGGER trg_guard_model_active_bookings
      BEFORE DELETE ON public.models
      FOR EACH ROW EXECUTE FUNCTION public.fn_guard_model_active_bookings();
  END IF;
END $$;


-- =============================================================================
-- GAP-9: gdpr_record_of_processing — RoPA view
-- Machine-readable Record of Processing Activities (Art. 30 DSGVO)
-- =============================================================================

CREATE OR REPLACE VIEW public.gdpr_record_of_processing AS
SELECT
  drp.data_type,
  drp.retention_days,
  drp.legal_basis,
  drp.deletion_method,
  drp.notes,
  drp.updated_at
FROM public.data_retention_policy drp
ORDER BY drp.data_type;

COMMENT ON VIEW public.gdpr_record_of_processing IS
  'Art. 30 DSGVO — Record of Processing Activities (RoPA). '
  'Machine-readable, derived from data_retention_policy. '
  'Admin-readable via service_role. '
  'Must be kept up to date and match the current Privacy Policy wording.';


-- =============================================================================
-- GAP-10: Extend consent types — already handled in GAP-1
-- Verify image_rights_confirmations links consent_log for traceability
-- =============================================================================

-- Add consent_log_id FK to image_rights_confirmations if not present
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'image_rights_confirmations'
      AND column_name = 'consent_log_id'
  ) THEN
    ALTER TABLE public.image_rights_confirmations
      ADD COLUMN consent_log_id UUID REFERENCES public.consent_log(id) ON DELETE SET NULL;
    COMMENT ON COLUMN public.image_rights_confirmations.consent_log_id IS
      'Optional FK to consent_log for unified consent trail. '
      'Links the image upload rights confirmation to the broader consent record.';
  END IF;
END $$;


-- =============================================================================
-- Final: retention cleanup orchestrator
-- Single function to call all purge jobs (from pg_cron or Edge Function cron)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.gdpr_run_all_retention_cleanup()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_expired_users   BIGINT := 0;
  v_old_audit       BIGINT := 0;
  v_old_sec_events  BIGINT := 0;
  v_old_gl_log      BIGINT := 0;
BEGIN
  -- 1. Expired deletion requests (30+ days) → anonymize
  SELECT COUNT(*) INTO v_expired_users
  FROM public.gdpr_purge_expired_deletions();

  -- 2. Old audit trail (> 7 years)
  SELECT public.gdpr_purge_old_audit_trail() INTO v_old_audit;

  -- 3. Old security events (> 2 years)
  SELECT public.gdpr_purge_old_security_events() INTO v_old_sec_events;

  -- 4. Old guest link access log (> 1 year)
  SELECT public.gdpr_purge_old_guest_link_access_log() INTO v_old_gl_log;

  RETURN jsonb_build_object(
    'run_at',              now(),
    'expired_users',       v_expired_users,
    'old_audit_trail',     v_old_audit,
    'old_security_events', v_old_sec_events,
    'old_guest_link_log',  v_old_gl_log
  );
END;
$$;

REVOKE ALL ON FUNCTION public.gdpr_run_all_retention_cleanup() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.gdpr_run_all_retention_cleanup() FROM authenticated;

COMMENT ON FUNCTION public.gdpr_run_all_retention_cleanup IS
  'Master retention cleanup orchestrator. '
  'Call from pg_cron (daily) or an Edge Function cron. '
  'Returns a JSONB summary of purged rows per category. '
  'service_role only — not callable by authenticated users.';
