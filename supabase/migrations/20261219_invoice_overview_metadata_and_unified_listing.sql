-- ============================================================================
-- Invoice Overview — Unified read RPC + tracking metadata (additive only).
-- 2026-12-19
--
-- WHY:
--   The Billing area exposes two separate invoice surfaces today:
--     * public.invoices         (Stripe-routed B2B; agency↔client/agency)
--     * public.manual_invoices  (manual PDFs; agency→client | agency→model | model→agency)
--   Operators want a SINGLE sortable / filterable overview across both
--   sources — plus a small per-invoice "tracking" surface (paid / open / problem +
--   internal note) that is independent from Stripe / payment-provider state.
--
-- WHAT THIS MIGRATION ADDS:
--   1. public.invoice_overview_metadata
--        Per-invoice operator-overlay (tracking_status, internal_note).
--        Keyed by (source_type, source_id).
--   2. public.invoice_overview_tracking_status enum
--        ('open' | 'paid' | 'problem')
--   3. public.list_invoice_overview(...)        SECURITY DEFINER read RPC
--        Unified rows from both invoice tables, filtered + paginated, scoped to
--        current authenticated user via public.is_org_member()/is_org_owner().
--        NEVER bypasses RLS for cross-org reads — internal guards mirror the
--        same boundary the source-table policies enforce.
--   4. public.update_invoice_tracking_status(...)  SECURITY DEFINER write RPC
--   5. public.update_invoice_tracking_note(...)    SECURITY DEFINER write RPC
--   6. audit_trail.action_type CHECK extended with two tracking actions.
--   7. log_invoice_tracking_audit() helper used by both update RPCs.
--
-- WHAT THIS MIGRATION DOES NOT TOUCH:
--   * No changes to public.invoices, invoice_line_items, invoice_events,
--     invoice_sequences, manual_invoices, manual_invoice_line_items,
--     organization_billing_profiles/defaults, agency_client_billing_presets,
--     agency_model_settlements (+ items), or any Stripe/Edge-Function logic.
--   * No money movement. tracking_status is OPERATOR-INTERNAL bookkeeping.
--   * No service_role grants. RPCs are SECURITY DEFINER but enforce membership
--     via auth.uid() + public.is_org_member()/is_org_owner().
--   * No new indexes on existing tables.
--   * No widening of RLS on existing tables.
--
-- VISIBILITY (mirrors existing source-table RLS):
--   * Agency org rows from invoices    : member-of-issuer-org (any operational
--                                         member; same as invoices_member_select)
--   * Agency org rows from manual      : member-of-agency-org (same as
--                                         manual_invoices_member_select)
--   * Client org rows from invoices    : owner-of-recipient-org AND status IN
--                                         ('sent','paid','overdue','void',
--                                         'uncollectible'); same as
--                                         invoices_recipient_owner_select
--   * Client org rows from manual      : never (manual is agency-internal)
--   * Models                           : never (firewall)
-- ============================================================================

-- ── ENUM ────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE public.invoice_overview_tracking_status AS ENUM (
    'open',
    'paid',
    'problem'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── TABLE: invoice_overview_metadata ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.invoice_overview_metadata (
  -- Composite logical key. We do NOT FK to either source table because the
  -- metadata table must accept rows for both source types. Cleanup is handled
  -- via best-effort triggers below.
  source_type        text NOT NULL,
  source_id          uuid NOT NULL,
  -- The owning agency org for both source types (issuer for invoices,
  -- agency_organization_id for manual_invoices). Used for RLS scoping and
  -- to keep this table cheap to filter without joining the source row.
  organization_id    uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  tracking_status    public.invoice_overview_tracking_status NOT NULL DEFAULT 'open',
  internal_note      text,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  updated_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invoice_overview_metadata_pk
    PRIMARY KEY (source_type, source_id),
  CONSTRAINT invoice_overview_metadata_source_type_chk
    CHECK (source_type IN ('system', 'manual')),
  CONSTRAINT invoice_overview_metadata_note_len_chk
    CHECK (internal_note IS NULL OR length(internal_note) <= 1000)
);

ALTER TABLE public.invoice_overview_metadata ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_invoice_overview_metadata_org
  ON public.invoice_overview_metadata (organization_id, source_type);

COMMENT ON TABLE public.invoice_overview_metadata IS
  'Operator-internal tracking overlay for invoices in the unified Invoice Overview. '
  'Independent from the source row''s lifecycle (Stripe / payment provider / generated). '
  'Writes only via update_invoice_tracking_status / update_invoice_tracking_note RPCs.';

-- Policies: SELECT for any org member of the owning org (mirrors source-table
-- read posture for issuer-side reads). Recipient owners do NOT get to write
-- tracking metadata — it is operator-internal to the agency org. Direct INSERT
-- is forbidden; the SECURITY DEFINER RPCs perform the upsert with an internal
-- guard. Direct UPDATE/DELETE blocked too.

DROP POLICY IF EXISTS "iom_admin_all" ON public.invoice_overview_metadata;
CREATE POLICY "iom_admin_all"
  ON public.invoice_overview_metadata
  FOR ALL
  TO authenticated
  USING (public.is_current_user_admin())
  WITH CHECK (public.is_current_user_admin());

DROP POLICY IF EXISTS "iom_member_select" ON public.invoice_overview_metadata;
CREATE POLICY "iom_member_select"
  ON public.invoice_overview_metadata
  FOR SELECT
  TO authenticated
  USING (public.is_org_member(organization_id));

-- ── Cascade cleanup when source rows are removed ────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_invoice_overview_metadata_cleanup_invoice()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.invoice_overview_metadata
   WHERE source_type = 'system' AND source_id = OLD.id;
  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_invoice_overview_metadata_cleanup_invoice() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS tr_invoices_iom_cleanup ON public.invoices;
CREATE TRIGGER tr_invoices_iom_cleanup
  AFTER DELETE ON public.invoices
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_invoice_overview_metadata_cleanup_invoice();

CREATE OR REPLACE FUNCTION public.fn_invoice_overview_metadata_cleanup_manual()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.invoice_overview_metadata
   WHERE source_type = 'manual' AND source_id = OLD.id;
  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_invoice_overview_metadata_cleanup_manual() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS tr_manual_invoices_iom_cleanup ON public.manual_invoices;
CREATE TRIGGER tr_manual_invoices_iom_cleanup
  AFTER DELETE ON public.manual_invoices
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_invoice_overview_metadata_cleanup_manual();

-- ── Audit action types extension (additive only) ────────────────────────────

ALTER TABLE public.audit_trail DROP CONSTRAINT IF EXISTS audit_trail_action_type_check;
ALTER TABLE public.audit_trail
  ADD CONSTRAINT audit_trail_action_type_check CHECK (action_type IN (
    -- GDPR
    'user_deleted', 'user_deletion_requested', 'user_deletion_cancelled',
    'org_deleted', 'data_exported',
    -- Bookings
    'booking_created', 'booking_confirmed', 'booking_cancelled',
    'booking_agency_accepted', 'booking_model_confirmed', 'booking_completed',
    -- Price / option negotiations
    'option_sent', 'option_price_proposed', 'option_price_countered',
    'option_price_accepted', 'option_price_rejected',
    'option_confirmed', 'option_rejected',
    'option_schedule_updated', 'option_document_uploaded',
    'option_request_deleted',
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
    'login_failed', 'permission_denied', 'suspicious_activity',
    -- Billing (20261122)
    'invoice_draft_created', 'invoice_draft_updated', 'invoice_draft_deleted',
    'invoice_line_added',    'invoice_line_updated',  'invoice_line_deleted',
    'invoice_sent', 'invoice_paid', 'invoice_payment_failed',
    'invoice_voided', 'invoice_overdue', 'invoice_uncollectible',
    'settlement_created', 'settlement_updated', 'settlement_deleted',
    'settlement_marked_recorded', 'settlement_marked_paid',
    'settlement_item_added', 'settlement_item_deleted',
    -- Invoice Overview (NEW 20261219)
    'invoice_tracking_status_updated',
    'invoice_tracking_note_updated'
  ));

-- ── INTERNAL: resolve owning org from (source_type, source_id) ──────────────
-- SECURITY DEFINER + row_security off so we can read both invoices and
-- manual_invoices without having to widen the calling user's RLS posture.
-- The result is ONLY used inside other SECDEF RPCs — never returned directly.

CREATE OR REPLACE FUNCTION public.fn_resolve_invoice_owning_org(
  p_source_type text,
  p_source_id   uuid
)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_org uuid;
BEGIN
  IF p_source_type = 'system' THEN
    SELECT organization_id INTO v_org
      FROM public.invoices
     WHERE id = p_source_id;
  ELSIF p_source_type = 'manual' THEN
    SELECT agency_organization_id INTO v_org
      FROM public.manual_invoices
     WHERE id = p_source_id;
  ELSE
    RETURN NULL;
  END IF;
  RETURN v_org;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_resolve_invoice_owning_org(text, uuid) FROM public, anon, authenticated;

-- ── RPC: list_invoice_overview ──────────────────────────────────────────────
-- Unified read across both invoice tables, scoped to the caller's visibility.
-- All filter parameters are typed and bound — no dynamic SQL.

CREATE OR REPLACE FUNCTION public.list_invoice_overview(
  p_organization_id uuid,
  p_year            int     DEFAULT NULL,
  p_month           int     DEFAULT NULL,           -- 1..12
  p_direction       text    DEFAULT NULL,           -- 'agency_to_client' | 'agency_to_model' | 'model_to_agency' | 'agency_to_agency'
  p_source_type     text    DEFAULT NULL,           -- 'system' | 'manual'
  p_tracking_status text    DEFAULT NULL,           -- 'open' | 'paid' | 'problem'
  p_search          text    DEFAULT NULL,           -- substring across recipient/sender/notes/invoice_number
  p_limit           int     DEFAULT 100,
  p_offset          int     DEFAULT 0
)
RETURNS TABLE (
  source_type        text,
  source_id          uuid,
  organization_id    uuid,
  invoice_number     text,
  direction          text,
  source_status      text,
  tracking_status    text,
  internal_note      text,
  invoice_date       date,
  due_date           date,
  currency           text,
  total_amount_cents bigint,
  sender_name        text,
  recipient_name     text,
  client_name        text,
  model_name         text,
  reference_label    text,
  has_payment_problem boolean,
  source_created_at  timestamptz,
  metadata_updated_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_uid          uuid := auth.uid();
  v_is_admin     boolean;
  v_is_member    boolean;
  v_is_recipient_owner boolean;
  v_lim          int;
  v_off          int;
  v_search       text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'organization_id required';
  END IF;

  -- Validate enums (defence in depth — also limits SQL surface).
  IF p_direction IS NOT NULL AND p_direction NOT IN (
    'agency_to_client', 'agency_to_model', 'model_to_agency', 'agency_to_agency'
  ) THEN
    RAISE EXCEPTION 'invalid_direction';
  END IF;
  IF p_source_type IS NOT NULL AND p_source_type NOT IN ('system', 'manual') THEN
    RAISE EXCEPTION 'invalid_source_type';
  END IF;
  IF p_tracking_status IS NOT NULL AND p_tracking_status NOT IN ('open', 'paid', 'problem') THEN
    RAISE EXCEPTION 'invalid_tracking_status';
  END IF;
  IF p_month IS NOT NULL AND (p_month < 1 OR p_month > 12) THEN
    RAISE EXCEPTION 'invalid_month';
  END IF;

  v_lim := LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500);
  v_off := GREATEST(COALESCE(p_offset, 0), 0);
  v_search := nullif(btrim(coalesce(p_search, '')), '');

  v_is_admin := public.is_current_user_admin();
  v_is_member := public.is_org_member(p_organization_id);
  v_is_recipient_owner := public.is_org_owner(p_organization_id);

  IF NOT (v_is_admin OR v_is_member OR v_is_recipient_owner) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  RETURN QUERY
  WITH unified AS (
    -- ── SYSTEM (Stripe-routed) invoices ────────────────────────────────────
    SELECT
      'system'::text                                     AS source_type,
      i.id                                               AS source_id,
      i.organization_id                                  AS organization_id,
      i.invoice_number                                   AS invoice_number,
      i.invoice_type::text                               AS direction,
      i.status::text                                     AS source_status,
      COALESCE(
        (i.recipient_billing_snapshot->>'billing_name'),
        (i.recipient_billing_snapshot->>'name')
      )                                                  AS recipient_name,
      COALESCE(
        (i.billing_profile_snapshot->>'billing_name'),
        (i.billing_profile_snapshot->>'name')
      )                                                  AS sender_name,
      NULL::text                                         AS client_name_raw,
      NULL::text                                         AS model_name_raw,
      NULL::text                                         AS reference_label_raw,
      i.currency                                         AS currency,
      i.total_amount_cents                               AS total_amount_cents,
      COALESCE(i.sent_at::date, i.created_at::date)      AS invoice_date,
      i.due_date                                         AS due_date,
      i.created_at                                       AS source_created_at,
      (i.last_stripe_failure_at IS NOT NULL OR i.status = 'overdue' OR i.status = 'uncollectible') AS has_payment_problem,
      -- Visibility filter mirrors invoices_member_select / invoices_recipient_owner_select.
      (
        v_is_admin
        OR (i.organization_id = p_organization_id AND v_is_member)
        OR (
          i.recipient_organization_id = p_organization_id
          AND v_is_recipient_owner
          AND i.status::text IN ('sent', 'paid', 'overdue', 'void', 'uncollectible')
        )
      ) AS is_visible
    FROM public.invoices i
    WHERE i.organization_id = p_organization_id
       OR i.recipient_organization_id = p_organization_id

    UNION ALL

    -- ── MANUAL invoices ────────────────────────────────────────────────────
    SELECT
      'manual'::text                                     AS source_type,
      mi.id                                              AS source_id,
      mi.agency_organization_id                          AS organization_id,
      mi.invoice_number                                  AS invoice_number,
      mi.direction::text                                 AS direction,
      mi.status::text                                    AS source_status,
      COALESCE(
        (mi.recipient_snapshot->>'legal_name'),
        (mi.recipient_snapshot->>'display_name')
      )                                                  AS recipient_name,
      COALESCE(
        (mi.sender_snapshot->>'legal_name'),
        (mi.sender_snapshot->>'trading_name')
      )                                                  AS sender_name,
      NULL::text                                         AS client_name_raw,
      NULL::text                                         AS model_name_raw,
      mi.job_reference                                   AS reference_label_raw,
      mi.currency                                        AS currency,
      mi.grand_total_cents                               AS total_amount_cents,
      COALESCE(mi.issue_date, mi.created_at::date)       AS invoice_date,
      mi.due_date                                        AS due_date,
      mi.created_at                                      AS source_created_at,
      false                                              AS has_payment_problem,
      -- Visibility filter mirrors manual_invoices_member_select.
      (v_is_admin OR (mi.agency_organization_id = p_organization_id AND v_is_member)) AS is_visible
    FROM public.manual_invoices mi
    WHERE mi.agency_organization_id = p_organization_id
  ),
  enriched AS (
    SELECT
      u.*,
      iom.tracking_status,
      iom.internal_note,
      iom.updated_at AS metadata_updated_at,
      -- Derive client/model labels from direction + recipient/sender.
      CASE
        WHEN u.direction IN ('agency_to_client', 'agency_to_agency')
          THEN u.recipient_name
        WHEN u.direction = 'model_to_agency'
          THEN u.recipient_name
        ELSE NULL
      END AS client_name,
      CASE
        WHEN u.direction = 'agency_to_model' THEN u.recipient_name
        WHEN u.direction = 'model_to_agency' THEN u.sender_name
        ELSE NULL
      END AS model_name
    FROM unified u
    LEFT JOIN public.invoice_overview_metadata iom
      ON iom.source_type = u.source_type AND iom.source_id = u.source_id
    WHERE u.is_visible
  )
  SELECT
    e.source_type,
    e.source_id,
    e.organization_id,
    e.invoice_number,
    e.direction,
    e.source_status,
    -- Effective tracking status: explicit override wins; otherwise derive a
    -- safe default from source state. NEVER mutates source data.
    COALESCE(
      e.tracking_status::text,
      CASE
        WHEN e.source_status = 'paid' THEN 'paid'
        WHEN e.has_payment_problem THEN 'problem'
        ELSE 'open'
      END
    ) AS tracking_status,
    e.internal_note,
    e.invoice_date,
    e.due_date,
    e.currency,
    e.total_amount_cents,
    e.sender_name,
    e.recipient_name,
    e.client_name,
    e.model_name,
    e.reference_label_raw AS reference_label,
    e.has_payment_problem,
    e.source_created_at,
    e.metadata_updated_at
  FROM enriched e
  WHERE
    (p_year IS NULL OR EXTRACT(YEAR FROM e.invoice_date)::int = p_year)
    AND (p_month IS NULL OR EXTRACT(MONTH FROM e.invoice_date)::int = p_month)
    AND (p_direction IS NULL OR e.direction = p_direction)
    AND (p_source_type IS NULL OR e.source_type = p_source_type)
    AND (
      p_tracking_status IS NULL
      OR COALESCE(
           e.tracking_status::text,
           CASE
             WHEN e.source_status = 'paid' THEN 'paid'
             WHEN e.has_payment_problem THEN 'problem'
             ELSE 'open'
           END
         ) = p_tracking_status
    )
    AND (
      v_search IS NULL
      OR (e.invoice_number ILIKE '%' || v_search || '%')
      OR (e.recipient_name ILIKE '%' || v_search || '%')
      OR (e.sender_name    ILIKE '%' || v_search || '%')
      OR (e.internal_note  ILIKE '%' || v_search || '%')
      OR (e.reference_label_raw ILIKE '%' || v_search || '%')
    )
  ORDER BY e.invoice_date DESC NULLS LAST, e.source_created_at DESC NULLS LAST
  LIMIT v_lim OFFSET v_off;
END;
$$;

REVOKE ALL    ON FUNCTION public.list_invoice_overview(uuid, int, int, text, text, text, text, int, int) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.list_invoice_overview(uuid, int, int, text, text, text, text, int, int) TO authenticated;

COMMENT ON FUNCTION public.list_invoice_overview IS
  'Unified invoice overview rows across public.invoices and public.manual_invoices, '
  'scoped to caller membership. Read-only. Internal IDs only via opaque (source_type, source_id).';

-- ── INTERNAL: tracking-update audit helper ──────────────────────────────────

CREATE OR REPLACE FUNCTION public.log_invoice_tracking_audit(
  p_org_id      uuid,
  p_action_type text,
  p_source_type text,
  p_source_id   uuid,
  p_old_data    jsonb DEFAULT NULL,
  p_new_data    jsonb DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
BEGIN
  INSERT INTO public.audit_trail (
    organization_id, user_id, action_type, entity_type, entity_id,
    old_data, new_data, source
  )
  VALUES (
    p_org_id,
    auth.uid(),
    p_action_type,
    'invoice_overview',
    p_source_id,
    COALESCE(p_old_data, '{}'::jsonb) || jsonb_build_object('source_type', p_source_type),
    COALESCE(p_new_data, '{}'::jsonb) || jsonb_build_object('source_type', p_source_type),
    'rpc'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.log_invoice_tracking_audit(uuid, text, text, uuid, jsonb, jsonb) FROM public, anon, authenticated;

-- ── RPC: update_invoice_tracking_status ─────────────────────────────────────

CREATE OR REPLACE FUNCTION public.update_invoice_tracking_status(
  p_source_type text,
  p_source_id   uuid,
  p_status      text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_org     uuid;
  v_old     public.invoice_overview_tracking_status;
  v_status  public.invoice_overview_tracking_status;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF p_source_type NOT IN ('system', 'manual') THEN
    RAISE EXCEPTION 'invalid_source_type';
  END IF;
  IF p_status NOT IN ('open', 'paid', 'problem') THEN
    RAISE EXCEPTION 'invalid_status';
  END IF;
  IF p_source_id IS NULL THEN
    RAISE EXCEPTION 'source_id required';
  END IF;

  v_status := p_status::public.invoice_overview_tracking_status;

  v_org := public.fn_resolve_invoice_owning_org(p_source_type, p_source_id);
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'invoice_not_found';
  END IF;

  -- Membership guard (mirrors source-table write posture for member operations).
  IF NOT (public.is_current_user_admin() OR public.is_org_member(v_org)) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  SELECT tracking_status INTO v_old
    FROM public.invoice_overview_metadata
   WHERE source_type = p_source_type AND source_id = p_source_id;

  INSERT INTO public.invoice_overview_metadata (
    source_type, source_id, organization_id, tracking_status, updated_at, updated_by
  )
  VALUES (p_source_type, p_source_id, v_org, v_status, now(), v_uid)
  ON CONFLICT (source_type, source_id) DO UPDATE
     SET tracking_status = EXCLUDED.tracking_status,
         updated_at      = now(),
         updated_by      = v_uid;

  PERFORM public.log_invoice_tracking_audit(
    v_org,
    'invoice_tracking_status_updated',
    p_source_type,
    p_source_id,
    jsonb_build_object('tracking_status', COALESCE(v_old::text, NULL)),
    jsonb_build_object('tracking_status', v_status::text)
  );

  RETURN jsonb_build_object(
    'ok', true,
    'source_type', p_source_type,
    'source_id', p_source_id,
    'tracking_status', v_status::text
  );
END;
$$;

REVOKE ALL    ON FUNCTION public.update_invoice_tracking_status(text, uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.update_invoice_tracking_status(text, uuid, text) TO authenticated;

COMMENT ON FUNCTION public.update_invoice_tracking_status IS
  'Operator-internal tracking status (open/paid/problem) for the unified Invoice Overview. '
  'Does NOT touch invoices/manual_invoices/Stripe state. Member-of-owning-org only.';

-- ── RPC: update_invoice_tracking_note ───────────────────────────────────────

CREATE OR REPLACE FUNCTION public.update_invoice_tracking_note(
  p_source_type text,
  p_source_id   uuid,
  p_note        text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_org       uuid;
  v_clean     text;
  v_old_note  text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF p_source_type NOT IN ('system', 'manual') THEN
    RAISE EXCEPTION 'invalid_source_type';
  END IF;
  IF p_source_id IS NULL THEN
    RAISE EXCEPTION 'source_id required';
  END IF;

  v_clean := btrim(coalesce(p_note, ''));
  IF length(v_clean) > 1000 THEN
    RAISE EXCEPTION 'note_too_long';
  END IF;
  IF v_clean = '' THEN
    v_clean := NULL;
  END IF;

  v_org := public.fn_resolve_invoice_owning_org(p_source_type, p_source_id);
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'invoice_not_found';
  END IF;

  IF NOT (public.is_current_user_admin() OR public.is_org_member(v_org)) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  SELECT internal_note INTO v_old_note
    FROM public.invoice_overview_metadata
   WHERE source_type = p_source_type AND source_id = p_source_id;

  INSERT INTO public.invoice_overview_metadata (
    source_type, source_id, organization_id, internal_note, updated_at, updated_by
  )
  VALUES (p_source_type, p_source_id, v_org, v_clean, now(), v_uid)
  ON CONFLICT (source_type, source_id) DO UPDATE
     SET internal_note = EXCLUDED.internal_note,
         updated_at    = now(),
         updated_by    = v_uid;

  PERFORM public.log_invoice_tracking_audit(
    v_org,
    'invoice_tracking_note_updated',
    p_source_type,
    p_source_id,
    -- Audit logs only the change FACT, not the full note text (keeps audit
    -- log compact and avoids duplicating sensitive operator notes).
    jsonb_build_object('had_note', v_old_note IS NOT NULL),
    jsonb_build_object('has_note', v_clean IS NOT NULL, 'note_length', COALESCE(length(v_clean), 0))
  );

  RETURN jsonb_build_object(
    'ok', true,
    'source_type', p_source_type,
    'source_id', p_source_id,
    'has_note', v_clean IS NOT NULL
  );
END;
$$;

REVOKE ALL    ON FUNCTION public.update_invoice_tracking_note(text, uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.update_invoice_tracking_note(text, uuid, text) TO authenticated;

COMMENT ON FUNCTION public.update_invoice_tracking_note IS
  'Operator-internal short note (<= 1000 chars) for the unified Invoice Overview. '
  'Does NOT touch invoices/manual_invoices state. Member-of-owning-org only.';

-- ── Verify (Management API runs this; also useful for psql sanity) ──────────
DO $$
BEGIN
  IF to_regclass('public.invoice_overview_metadata') IS NULL THEN
    RAISE EXCEPTION 'invoice_overview_metadata not present';
  END IF;
  IF to_regprocedure('public.list_invoice_overview(uuid, int, int, text, text, text, text, int, int)') IS NULL THEN
    RAISE EXCEPTION 'list_invoice_overview missing';
  END IF;
  IF to_regprocedure('public.update_invoice_tracking_status(text, uuid, text)') IS NULL THEN
    RAISE EXCEPTION 'update_invoice_tracking_status missing';
  END IF;
  IF to_regprocedure('public.update_invoice_tracking_note(text, uuid, text)') IS NULL THEN
    RAISE EXCEPTION 'update_invoice_tracking_note missing';
  END IF;
END $$;
