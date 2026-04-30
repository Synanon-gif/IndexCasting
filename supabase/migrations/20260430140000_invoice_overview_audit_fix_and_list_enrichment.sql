-- ============================================================================
-- Invoice Overview — minimal production fixes (2026-04-30)
--
-- 1) log_invoice_tracking_audit used invalid column `organization_id`.
--    `audit_trail` uses `org_id` → every tracking status update failed (HTTP 400).
--
-- 2) list_invoice_overview: richer From/To via snapshots + org/profile fallbacks;
--    append sanitized Stripe HTTPS URLs only (hosted + PDF) for safe UI actions.
--
-- No changes to invoices/manual_invoices data, Stripe flows, or RLS widening.
-- ============================================================================

-- ── INTERNAL: whitelist Stripe HTTPS URLs for overview links only ───────────

CREATE OR REPLACE FUNCTION public.fn_invoice_overview_safe_stripe_https_url(p_url text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_url IS NULL OR length(btrim(p_url)) = 0 THEN NULL
    WHEN btrim(p_url) !~ '^https://' THEN NULL
    WHEN btrim(p_url) ~ '^https://([a-zA-Z0-9-]+\.)*stripe\.com(/|$|\?)' THEN btrim(p_url)
    ELSE NULL
  END;
$$;

REVOKE ALL ON FUNCTION public.fn_invoice_overview_safe_stripe_https_url(text) FROM public, anon, authenticated;

COMMENT ON FUNCTION public.fn_invoice_overview_safe_stripe_https_url(text) IS
  'Returns p_url only when it is a strict https://*.stripe.com/* pattern; else NULL. '
  'Used only by list_invoice_overview — never stores or mutates invoice rows.';

-- ── Fix audit helper (correct audit_trail.org_id column) ─────────────────────

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
    org_id,
    user_id,
    action_type,
    entity_type,
    entity_id,
    old_data,
    new_data,
    source
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

-- ── RPC: list_invoice_overview (replace body — same signature & grants) ─────
-- Postgres forbids changing OUT/RETURNS shape via CREATE OR REPLACE alone.

DROP FUNCTION IF EXISTS public.list_invoice_overview(uuid, int, int, text, text, text, text, int, int);

CREATE FUNCTION public.list_invoice_overview(
  p_organization_id uuid,
  p_year            int     DEFAULT NULL,
  p_month           int     DEFAULT NULL,
  p_direction       text    DEFAULT NULL,
  p_source_type     text    DEFAULT NULL,
  p_tracking_status text    DEFAULT NULL,
  p_search          text    DEFAULT NULL,
  p_limit           int     DEFAULT 100,
  p_offset          int     DEFAULT 0
)
RETURNS TABLE (
  source_type         text,
  source_id           uuid,
  organization_id     uuid,
  invoice_number      text,
  direction           text,
  source_status       text,
  tracking_status     text,
  internal_note       text,
  invoice_date        date,
  due_date            date,
  currency            text,
  total_amount_cents  bigint,
  sender_name         text,
  recipient_name      text,
  client_name         text,
  model_name          text,
  reference_label     text,
  has_payment_problem boolean,
  source_created_at   timestamptz,
  metadata_updated_at timestamptz,
  hosted_invoice_url  text,
  invoice_pdf_url     text
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
    SELECT
      'system'::text                                     AS source_type,
      i.id                                               AS source_id,
      i.organization_id                                  AS organization_id,
      i.invoice_number                                   AS invoice_number,
      i.invoice_type::text                               AS direction,
      i.status::text                                     AS source_status,
      COALESCE(
        NULLIF(btrim(i.recipient_billing_snapshot->>'billing_name'), ''),
        NULLIF(btrim(i.recipient_billing_snapshot->>'name'), ''),
        NULLIF(btrim(org_recipient.name), '')
      )                                                  AS recipient_name,
      COALESCE(
        NULLIF(btrim(i.billing_profile_snapshot->>'billing_name'), ''),
        NULLIF(btrim(i.billing_profile_snapshot->>'name'), ''),
        NULLIF(btrim(org_issuer.name), '')
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
      public.fn_invoice_overview_safe_stripe_https_url(i.stripe_hosted_url) AS hosted_invoice_url,
      public.fn_invoice_overview_safe_stripe_https_url(i.stripe_pdf_url)    AS invoice_pdf_url,
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
    LEFT JOIN public.organizations org_issuer ON org_issuer.id = i.organization_id
    LEFT JOIN public.organizations org_recipient ON org_recipient.id = i.recipient_organization_id
    WHERE i.organization_id = p_organization_id
       OR i.recipient_organization_id = p_organization_id

    UNION ALL

    SELECT
      'manual'::text                                     AS source_type,
      mi.id                                              AS source_id,
      mi.agency_organization_id                          AS organization_id,
      mi.invoice_number                                  AS invoice_number,
      mi.direction::text                                 AS direction,
      mi.status::text                                    AS source_status,
      COALESCE(
        NULLIF(btrim(mi.recipient_snapshot->>'legal_name'), ''),
        NULLIF(btrim(mi.recipient_snapshot->>'display_name'), ''),
        NULLIF(btrim(sap_recipient.legal_name), ''),
        NULLIF(btrim(sap_recipient.trading_name), ''),
        NULLIF(btrim(scp_recipient.legal_name), ''),
        NULLIF(btrim(scp_recipient.display_name), '')
      )                                                  AS recipient_name,
      COALESCE(
        NULLIF(btrim(mi.sender_snapshot->>'legal_name'), ''),
        NULLIF(btrim(mi.sender_snapshot->>'trading_name'), ''),
        NULLIF(btrim(sap_sender.legal_name), ''),
        NULLIF(btrim(sap_sender.trading_name), ''),
        NULLIF(btrim(scp_sender.legal_name), ''),
        NULLIF(btrim(scp_sender.display_name), '')
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
      NULL::text                                         AS hosted_invoice_url,
      NULL::text                                         AS invoice_pdf_url,
      (v_is_admin OR (mi.agency_organization_id = p_organization_id AND v_is_member)) AS is_visible
    FROM public.manual_invoices mi
    LEFT JOIN public.manual_billing_agency_profiles sap_sender
      ON sap_sender.id = mi.sender_agency_profile_id
    LEFT JOIN public.manual_billing_counterparties scp_sender
      ON scp_sender.id = mi.sender_counterparty_id
    LEFT JOIN public.manual_billing_agency_profiles sap_recipient
      ON sap_recipient.id = mi.recipient_agency_profile_id
    LEFT JOIN public.manual_billing_counterparties scp_recipient
      ON scp_recipient.id = mi.recipient_counterparty_id
    WHERE mi.agency_organization_id = p_organization_id
  ),
  enriched AS (
    SELECT
      u.*,
      iom.tracking_status,
      iom.internal_note,
      iom.updated_at AS metadata_updated_at,
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
    e.metadata_updated_at,
    e.hosted_invoice_url,
    e.invoice_pdf_url
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
  'scoped to caller membership. Read-only. Adds sanitized Stripe HTTPS links only.';

-- ── RPC: update_invoice_tracking_status — tolerate trimmed status text ───────

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
  v_stat_in text := lower(btrim(coalesce(p_status, '')));
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF p_source_type NOT IN ('system', 'manual') THEN
    RAISE EXCEPTION 'invalid_source_type';
  END IF;
  IF v_stat_in NOT IN ('open', 'paid', 'problem') THEN
    RAISE EXCEPTION 'invalid_status';
  END IF;
  IF p_source_id IS NULL THEN
    RAISE EXCEPTION 'source_id required';
  END IF;

  v_status := CASE v_stat_in
    WHEN 'open' THEN 'open'::public.invoice_overview_tracking_status
    WHEN 'paid' THEN 'paid'::public.invoice_overview_tracking_status
    WHEN 'problem' THEN 'problem'::public.invoice_overview_tracking_status
    ELSE NULL
  END;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'invalid_status';
  END IF;

  v_org := public.fn_resolve_invoice_owning_org(p_source_type, p_source_id);
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'invoice_not_found';
  END IF;

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
    jsonb_build_object('tracking_status', v_old::text),
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
