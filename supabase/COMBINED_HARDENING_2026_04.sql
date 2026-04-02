-- =============================================================================
-- SECURITY HARDENING 2026-04 — Alle 4 Migrations kombiniert
-- Reihenfolge: access_gate → rls_collision → stripe_idempotency → guest_rate_limit
-- Einfach in den Supabase SQL Editor (ispkfdqzjrfrilosoklu) einfügen + RUN
-- =============================================================================


-- ════════════════════════════════════════════════════════════════════════════
-- 1/4: migration_access_gate_enforcement.sql
-- ════════════════════════════════════════════════════════════════════════════

-- =============================================================================
-- Access Gate Enforcement — 2026-04 Security Hardening
--
-- Closes the backend paywall bypass identified in the 2026-04 audit:
--
--   BYPASS-01 (CRITICAL): get_models_by_location() is SECURITY INVOKER with
--     no can_access_platform() call. Any authenticated user (expired trial,
--     cancelled subscription) can discover models by calling the RPC directly.
--     Fix: add access gate check at the top of the function for authenticated
--     callers. Anon callers (guest-link viewers) are exempt because they have
--     no organisation membership and use the scoped get_guest_link_models() RPC.
--
--   BYPASS-02 (CRITICAL): option_requests INSERT RLS policy
--     option_requests_insert_client does NOT check platform access. A direct
--     PostgREST API call with a valid but expired-subscription JWT can insert
--     option requests.
--     Fix: add has_platform_access() to the WITH CHECK clause.
--
--   BYPASS-03 (CRITICAL): messages INSERT RLS policy messages_insert_sender
--     does NOT check platform access. A direct API call can send messages
--     without a valid subscription.
--     Fix: add has_platform_access() to the WITH CHECK clause.
--
-- New helper:
--   has_platform_access() BOOLEAN — thin STABLE SECURITY DEFINER wrapper
--   around can_access_platform(). Being STABLE means Postgres evaluates it
--   once per statement (not once per row), so the cost is a single lookup
--   per INSERT, not N lookups per batch.
--
-- Run AFTER migration_hardening_2026_04_final.sql.
-- Idempotent: CREATE OR REPLACE / DROP IF EXISTS guards throughout.
-- =============================================================================


-- ─── 1. Boolean helper: has_platform_access() ─────────────────────────────

CREATE OR REPLACE FUNCTION public.has_platform_access()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  RETURN COALESCE(
    ((public.can_access_platform()) ->> 'allowed')::BOOLEAN,
    false
  );
END;
$$;

REVOKE ALL    ON FUNCTION public.has_platform_access() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_platform_access() TO authenticated;

COMMENT ON FUNCTION public.has_platform_access() IS
  'Boolean shorthand for can_access_platform(). STABLE so Postgres evaluates '
  'it once per statement when used inside RLS policies, not once per row. '
  'BYPASS-01/02/03 fix (2026-04 audit).';


-- ─── 2. BYPASS-02: Tighten option_requests INSERT policy ──────────────────
--
-- The previous policy (migration_rls_fix_option_requests_safety.sql) only
-- verified org membership. We now also require a valid platform subscription.

DROP POLICY IF EXISTS "option_requests_insert_client" ON public.option_requests;

CREATE POLICY option_requests_insert_client
  ON public.option_requests
  FOR INSERT
  TO authenticated
  WITH CHECK (
    client_id = auth.uid()
    AND public.has_platform_access()
    AND (
      organization_id IS NULL
      OR EXISTS (
        SELECT 1
        FROM public.organization_members m
        WHERE m.organization_id = option_requests.organization_id
          AND m.user_id = auth.uid()
      )
    )
  );

COMMENT ON POLICY option_requests_insert_client ON public.option_requests IS
  'Clients may create option requests only if they belong to the org AND have '
  'an active subscription / trial / admin override. BYPASS-02 fix 2026-04.';


-- ─── 3. BYPASS-03: Tighten messages INSERT policy ─────────────────────────
--
-- Drop the existing policy (defined in migration_connection_messenger_org_scope.sql)
-- and recreate with the additional has_platform_access() guard.

DROP POLICY IF EXISTS "messages_insert_sender" ON public.messages;

CREATE POLICY "messages_insert_sender"
  ON public.messages
  FOR INSERT
  TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND public.conversation_accessible_to_me(conversation_id)
    AND public.has_platform_access()
  );

COMMENT ON POLICY "messages_insert_sender" ON public.messages IS
  'Senders may insert messages only into accessible conversations AND when '
  'the platform is accessible (active subscription / trial / override). '
  'BYPASS-03 fix 2026-04.';


-- ─── 4. BYPASS-01: Add access gate to get_models_by_location() ────────────
--
-- Drop old function signatures before redefining (language change sql→plpgsql
-- requires DROP because return type / language are part of the function
-- signature in some Postgres versions).
DROP FUNCTION IF EXISTS public.get_models_by_location(
  text, text, integer, integer, text, text, boolean, boolean,
  integer, integer, text, integer, integer, integer, integer,
  integer, integer, integer, integer, text
);
DROP FUNCTION IF EXISTS public.get_models_by_location(
  text, text, integer, integer, text, text, boolean, boolean,
  integer, integer, text, integer, integer, integer, integer,
  integer, integer, integer, integer, text, text[]
);

CREATE OR REPLACE FUNCTION public.get_models_by_location(
  p_iso             text,
  p_client_type     text      DEFAULT 'all',
  p_from            integer   DEFAULT 0,
  p_to              integer   DEFAULT 999,
  p_city            text      DEFAULT NULL,
  p_category        text      DEFAULT NULL,
  p_sports_winter   boolean   DEFAULT FALSE,
  p_sports_summer   boolean   DEFAULT FALSE,
  p_height_min      integer   DEFAULT NULL,
  p_height_max      integer   DEFAULT NULL,
  p_hair_color      text      DEFAULT NULL,
  p_hips_min        integer   DEFAULT NULL,
  p_hips_max        integer   DEFAULT NULL,
  p_waist_min       integer   DEFAULT NULL,
  p_waist_max       integer   DEFAULT NULL,
  p_chest_min       integer   DEFAULT NULL,
  p_chest_max       integer   DEFAULT NULL,
  p_legs_inseam_min integer   DEFAULT NULL,
  p_legs_inseam_max integer   DEFAULT NULL,
  p_sex             text      DEFAULT NULL,
  p_ethnicities     text[]    DEFAULT NULL
)
RETURNS SETOF jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  -- Enforce paywall for authenticated users only.
  -- Anon callers are guest-link viewers who use the separate scoped RPC
  -- get_guest_link_models() — they have no organisation and must not be
  -- blocked here (they also cannot call this RPC in practice since the
  -- client SDK always calls get_guest_link_models for guest flows).
  IF auth.role() = 'authenticated' THEN
    IF NOT public.has_platform_access() THEN
      RAISE EXCEPTION 'platform_access_denied'
        USING HINT = 'Active subscription or trial required to discover models.',
              ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN QUERY
  SELECT to_jsonb(result)
  FROM (
    SELECT
      m.*,
      mat.country_code  AS territory_country_code,
      a.name            AS agency_name,
      mat.agency_id     AS territory_agency_id
    FROM public.models m
    JOIN public.model_agency_territories mat ON mat.model_id   = m.id
    JOIN public.agencies                 a   ON a.id           = mat.agency_id
    WHERE
      mat.country_code = p_iso
      AND (
        m.agency_relationship_status IS NULL
        OR m.agency_relationship_status IN ('active', 'pending_link')
      )
      AND (
        p_client_type = 'all'
        OR (p_client_type = 'fashion'    AND m.is_visible_fashion    = TRUE)
        OR (p_client_type = 'commercial' AND m.is_visible_commercial = TRUE)
      )
      AND (NOT p_sports_winter OR m.is_sports_winter = TRUE)
      AND (NOT p_sports_summer OR m.is_sports_summer = TRUE)
      AND (p_height_min      IS NULL OR m.height      >= p_height_min)
      AND (p_height_max      IS NULL OR m.height      <= p_height_max)
      AND (p_hips_min        IS NULL OR m.hips        >= p_hips_min)
      AND (p_hips_max        IS NULL OR m.hips        <= p_hips_max)
      AND (p_waist_min       IS NULL OR m.waist       >= p_waist_min)
      AND (p_waist_max       IS NULL OR m.waist       <= p_waist_max)
      AND (p_chest_min       IS NULL OR m.chest       >= p_chest_min)
      AND (p_chest_max       IS NULL OR m.chest       <= p_chest_max)
      AND (p_legs_inseam_min IS NULL OR m.legs_inseam >= p_legs_inseam_min)
      AND (p_legs_inseam_max IS NULL OR m.legs_inseam <= p_legs_inseam_max)
      AND (p_sex             IS NULL OR m.sex         =  p_sex)
      AND (
        p_hair_color IS NULL OR p_hair_color = ''
        OR m.hair_color ILIKE ('%' || p_hair_color || '%')
      )
      AND (
        p_city IS NULL OR p_city = ''
        OR m.city ILIKE p_city
      )
      AND (
        p_category IS NULL
        OR m.categories IS NULL
        OR m.categories = '{}'
        OR m.categories @> ARRAY[p_category]
      )
      AND (
        p_ethnicities IS NULL
        OR array_length(p_ethnicities, 1) IS NULL
        OR m.ethnicity = ANY(p_ethnicities)
      )
    ORDER BY m.name
    OFFSET p_from
    LIMIT  (p_to - p_from + 1)
  ) result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_models_by_location(
  text, text, integer, integer, text, text, boolean, boolean,
  integer, integer, text, integer, integer, integer, integer,
  integer, integer, integer, integer, text, text[]
) TO authenticated, anon;

COMMENT ON FUNCTION public.get_models_by_location(
  text, text, integer, integer, text, text, boolean, boolean,
  integer, integer, text, integer, integer, integer, integer,
  integer, integer, integer, integer, text, text[]
) IS
  'Territory-based model discovery. Authenticated callers must have an active '
  'subscription / trial / admin override (BYPASS-01 fix 2026-04). '
  'Anon callers (guest-link viewers) are exempt — they use get_guest_link_models().';


-- ════════════════════════════════════════════════════════════════════════════
-- 2/4: migration_rls_collision_fix.sql
-- ════════════════════════════════════════════════════════════════════════════

-- =============================================================================
-- RLS Collision Fix — 2026-04 Security Hardening
--
-- Closes remaining USING(true) / WITH CHECK(true) policy gaps. Many earlier
-- migrations already replaced broad policies; this file is the authoritative
-- safety net that ensures the final live-DB state is tight regardless of
-- migration execution order.
--
-- Issues addressed:
--
--   RLS-01 (HIGH): option_documents — "Authenticated can manage option
--     documents" FOR ALL USING(true) WITH CHECK(true). Any authenticated user
--     can read, insert, update, or delete any option document.
--     Fix: scope to option request participants via option_request_visible_to_me().
--
--   RLS-02 (HIGH): client_agency_connections UPDATE — both "Client updates
--     own connection rows" and "Agency org updates connection for their agency"
--     have WITH CHECK(true). The USING clause is correctly scoped, but any
--     value can be written to any column (including client_id / agency_id),
--     enabling cross-org tenant pivoting after gaining update access.
--     Fix: WITH CHECK mirrors the USING predicate for both policies.
--
--   RLS-03 (SAFETY NET): Re-confirm that earlier migrations' DROP + RECREATE
--     for model_applications, option_request_messages, recruiting_chat_*, and
--     model_locations ran correctly. If not, re-apply here idempotently.
--
-- Live-DB verification query (run manually after applying):
--   SELECT schemaname, tablename, policyname, cmd,
--          qual    AS using_clause,
--          with_check AS with_check_clause
--   FROM   pg_policies
--   WHERE  schemaname = 'public'
--     AND  tablename IN (
--            'option_documents','client_agency_connections',
--            'model_applications','option_request_messages',
--            'recruiting_chat_threads','recruiting_chat_messages',
--            'model_locations'
--          )
--   ORDER  BY tablename, cmd, policyname;
--
-- Run AFTER migration_access_gate_enforcement.sql.
-- Idempotent: all DROP IF EXISTS / IF NOT EXISTS guards.
-- =============================================================================


-- ─── RLS-01: option_documents — scope to option request participants ─────────

DROP POLICY IF EXISTS "Anyone can manage option documents"       ON public.option_documents;
DROP POLICY IF EXISTS "Authenticated can manage option documents" ON public.option_documents;
DROP POLICY IF EXISTS "option_documents_select_participant"       ON public.option_documents;
DROP POLICY IF EXISTS "option_documents_insert_participant"       ON public.option_documents;
DROP POLICY IF EXISTS "option_documents_delete_participant"       ON public.option_documents;

-- SELECT: visible only to participants of the parent option request
CREATE POLICY option_documents_select_participant
  ON public.option_documents
  FOR SELECT
  TO authenticated
  USING (public.option_request_visible_to_me(option_request_id));

-- INSERT: participants of the parent option request may attach documents
CREATE POLICY option_documents_insert_participant
  ON public.option_documents
  FOR INSERT
  TO authenticated
  WITH CHECK (public.option_request_visible_to_me(option_request_id));

-- DELETE: only the uploader may remove their own document
CREATE POLICY option_documents_delete_own
  ON public.option_documents
  FOR DELETE
  TO authenticated
  USING (
    uploaded_by = auth.uid()::text
    AND public.option_request_visible_to_me(option_request_id)
  );

COMMENT ON POLICY option_documents_select_participant ON public.option_documents IS
  'Only option request participants (client org + agency org) may read documents. '
  'RLS-01 fix 2026-04 — replaces FOR ALL USING(true).';


-- ─── RLS-02: client_agency_connections UPDATE — fix WITH CHECK(true) ─────────
--
-- The USING clause is already correctly scoped (from
-- migration_connection_messenger_org_scope.sql). Only the WITH CHECK needs
-- to mirror USING so that participants cannot write arbitrary column values
-- (e.g. swap client_id / agency_id to pivot across tenants).

DROP POLICY IF EXISTS "Client updates own connection rows"              ON public.client_agency_connections;
DROP POLICY IF EXISTS "Agency org updates connection for their agency"  ON public.client_agency_connections;

CREATE POLICY "Client updates own connection rows"
  ON public.client_agency_connections
  FOR UPDATE
  TO authenticated
  USING (
    client_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.organization_members m1
      JOIN public.organization_members m2 ON m1.organization_id = m2.organization_id
      JOIN public.organizations o         ON o.id = m1.organization_id AND o.type = 'client'
      WHERE m1.user_id = auth.uid()
        AND m2.user_id = client_agency_connections.client_id
    )
  )
  -- WITH CHECK mirrors USING — prevents writing arbitrary column values
  WITH CHECK (
    client_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.organization_members m1
      JOIN public.organization_members m2 ON m1.organization_id = m2.organization_id
      JOIN public.organizations o         ON o.id = m1.organization_id AND o.type = 'client'
      WHERE m1.user_id = auth.uid()
        AND m2.user_id = client_agency_connections.client_id
    )
  );

CREATE POLICY "Agency org updates connection for their agency"
  ON public.client_agency_connections
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.organizations o
      JOIN public.organization_members m ON m.organization_id = o.id AND m.user_id = auth.uid()
      WHERE o.type      = 'agency'
        AND o.agency_id = client_agency_connections.agency_id
    )
  )
  -- WITH CHECK mirrors USING — prevents agency from reassigning the connection
  -- to a different agency_id or pivoting the client_id
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.organizations o
      JOIN public.organization_members m ON m.organization_id = o.id AND m.user_id = auth.uid()
      WHERE o.type      = 'agency'
        AND o.agency_id = client_agency_connections.agency_id
    )
  );


-- ─── RLS-03: Safety-net re-applications ──────────────────────────────────────
--
-- The following DROP + RECREATE blocks are no-ops when the earlier migrations
-- ran correctly. They exist to guarantee the tight policy state even if
-- migrations were applied out of order or partially rolled back.

-- model_applications INSERT (anon: applicant_user_id must be NULL)
DROP POLICY IF EXISTS "Anon can insert applications" ON public.model_applications;
CREATE POLICY "Anon can insert applications"
  ON public.model_applications
  FOR INSERT
  TO anon
  WITH CHECK (applicant_user_id IS NULL);

-- option_request_messages INSERT — scope to request participants
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'option_request_messages'
      AND policyname = 'option_messages_insert_if_request_visible'
  ) THEN
    -- Earlier migration_rls_fix_option_requests_safety.sql was not applied.
    -- Apply the scoped policy now.
    EXECUTE $policy$
      CREATE POLICY option_messages_insert_if_request_visible
        ON public.option_request_messages FOR INSERT TO authenticated
        WITH CHECK (public.option_request_visible_to_me(option_request_id))
    $policy$;
  END IF;
END $$;

-- Ensure the broad schema.sql INSERT policy for option_request_messages is gone
DROP POLICY IF EXISTS "Participants can insert option messages" ON public.option_request_messages;

-- Ensure the broad schema.sql INSERT policy for model_applications is gone
DROP POLICY IF EXISTS "Authenticated can insert applications" ON public.model_applications;


-- ════════════════════════════════════════════════════════════════════════════
-- 3/4: migration_stripe_webhook_idempotency.sql
-- ════════════════════════════════════════════════════════════════════════════

-- =============================================================================
-- Stripe Webhook Idempotency — 2026-04 Security Hardening
--
-- Closes replay-attack window in the stripe-webhook Edge Function:
--
--   REPLAY-01 (HIGH): constructEventAsync validates the Stripe signature and
--     timestamp (default 300-second tolerance window). Within that window,
--     the same event payload can be delivered and processed multiple times
--     by Stripe retry logic, network duplicates, or deliberate replay. This
--     can cause double-subscription activations, double plan upgrades, etc.
--     Fix: persist the Stripe event.id after first successful processing.
--          Subsequent deliveries of the same event.id return 200 immediately
--          (idempotent acknowledgement) without re-running business logic.
--
-- Table: stripe_processed_events
--   event_id     – Stripe's globally-unique event identifier (evt_…)
--   processed_at – UTC timestamp of first successful processing
--
-- Retention: rows older than 30 days are automatically purged by a scheduled
--   Supabase cron job or pg_cron (set up separately). 30 days comfortably
--   exceeds Stripe's retry window (72 hours / 3 days).
--
-- RLS: Table is intentionally NOT accessible via the public schema anon/authenticated
--   roles. Only the service_role key (Edge Function) may read/write. The RLS
--   policies below reflect this by granting NO access to non-service roles.
--   (The Edge Function uses service_role and bypasses RLS entirely.)
--
-- Run AFTER migration_access_gate_enforcement.sql.
-- Idempotent.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.stripe_processed_events (
  event_id     TEXT        PRIMARY KEY,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for range-delete pruning (TTL cleanup)
CREATE INDEX IF NOT EXISTS idx_stripe_processed_events_processed_at
  ON public.stripe_processed_events (processed_at);

-- Enable RLS — no policy for anon/authenticated means the table is invisible
-- to all JWT callers. The service_role key bypasses RLS completely, which is
-- the only caller path (Edge Function). This is intentional.
ALTER TABLE public.stripe_processed_events ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.stripe_processed_events IS
  'Idempotency log for Stripe webhook events. '
  'Stores event_id of each successfully processed Stripe event to prevent '
  'duplicate processing within Stripe''s retry / replay window. '
  'Accessible only via service_role (Edge Function). '
  'REPLAY-01 fix 2026-04 audit.';

COMMENT ON COLUMN public.stripe_processed_events.event_id IS
  'Stripe event identifier (evt_…). Primary key — INSERT fails on duplicate.';

COMMENT ON COLUMN public.stripe_processed_events.processed_at IS
  'UTC timestamp of first successful processing. Used for TTL cleanup.';


-- ─── Optional: Automatic 30-day pruning via pg_cron ─────────────────────────
--
-- Uncomment and run once if pg_cron is enabled on the Supabase project.
-- This keeps the table small (Stripe retries at most for 3 days).
--
-- SELECT cron.schedule(
--   'prune_stripe_processed_events',
--   '0 3 * * *',   -- daily at 03:00 UTC
--   $$
--     DELETE FROM public.stripe_processed_events
--     WHERE processed_at < now() - INTERVAL '30 days'
--   $$
-- );


-- ════════════════════════════════════════════════════════════════════════════
-- 4/4: migration_guest_link_rate_limit.sql
-- ════════════════════════════════════════════════════════════════════════════

-- =============================================================================
-- Guest Link Rate Limiting — 2026-04 Security Hardening
--
-- Protects get_guest_link_info() and get_guest_link_models() against
-- high-frequency abuse (DoS / automated scraping) by enforcing a per-IP
-- request budget tracked entirely inside PostgreSQL.
--
-- Why DB-side? The functions are SECURITY DEFINER and run in Postgres; the
-- calling IP address is available in the request context via the Supabase
-- PostgREST `request.headers` GUC (available in RPC bodies). No external
-- infra change is needed.
--
-- Rate limit: 60 calls per minute per IP (1 call/second burst budget).
-- Each call to get_guest_link_info or get_guest_link_models consumes one
-- token. The window resets at the start of each UTC minute.
--
-- Table: guest_link_rate_limit
--   ip_hash      – SHA-256 of the caller IP (never stores raw IP — GDPR)
--   window_start – truncated to the current UTC minute
--   request_count – number of calls in this window
--   PRIMARY KEY  (ip_hash, window_start) — one row per (IP, minute)
--
-- Cleanup: rows older than 2 minutes are pruned on each write (cheap: the
-- row exists only for the current + previous minute at most).
--
-- Note on Supabase deployment:
--   request.headers is available in SECURITY DEFINER RPCs called through
--   PostgREST. When called from a Supabase Edge Function (server-side), the
--   function receives the Edge Function's outbound IP, not the end-user IP.
--   For browser/app callers, the end-user IP is forwarded.
--
-- Fallback: if the IP header cannot be read (e.g. direct DB connection
-- without PostgREST), no IP is extracted and rate limiting is skipped
-- (fail-open for admin/backend use; the function still validates the link).
--
-- Run AFTER migration_hardening_2026_04_final.sql.
-- Idempotent.
-- =============================================================================

-- ─── 1. Rate-limit tracking table ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.guest_link_rate_limit (
  ip_hash       TEXT        NOT NULL,
  window_start  TIMESTAMPTZ NOT NULL,
  request_count INTEGER     NOT NULL DEFAULT 1,
  PRIMARY KEY (ip_hash, window_start)
);

-- Partial index for fast cleanup of expired windows
CREATE INDEX IF NOT EXISTS idx_guest_link_rate_limit_window
  ON public.guest_link_rate_limit (window_start);

-- No RLS needed: the table is only accessed via SECURITY DEFINER RPCs.
-- Direct table access is blocked by not granting any privileges to anon/authenticated.
ALTER TABLE public.guest_link_rate_limit ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.guest_link_rate_limit IS
  'Per-IP rate-limit counters for guest link RPCs. '
  'Stores SHA-256(ip) to avoid storing raw IPs (GDPR). '
  'One row per (ip_hash, minute). Rows older than 2 minutes are pruned on write. '
  '2026-04 hardening.';


-- ─── 2. Helper: enforce_guest_link_rate_limit() ───────────────────────────────
--
-- Called at the top of each guest link RPC.
-- Returns TRUE if the caller is within budget, FALSE if over the limit.
-- All DB writes are contained here; the calling RPC just checks the return value.

CREATE OR REPLACE FUNCTION public.enforce_guest_link_rate_limit(
  p_max_requests_per_minute INTEGER DEFAULT 60
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_raw_ip      TEXT;
  v_ip_hash     TEXT;
  v_window      TIMESTAMPTZ;
  v_count       INTEGER;
BEGIN
  -- Extract caller IP from PostgREST request headers (only available when
  -- the function is called through the REST API, not direct DB connections).
  BEGIN
    v_raw_ip := current_setting('request.headers', true)::json->>'x-forwarded-for';
  EXCEPTION WHEN OTHERS THEN
    v_raw_ip := NULL;
  END;

  -- Trim to the first IP in X-Forwarded-For (may be a comma-separated list)
  IF v_raw_ip IS NOT NULL THEN
    v_raw_ip := split_part(trim(v_raw_ip), ',', 1);
  END IF;

  -- No IP available (direct DB / Edge Function server-side) — skip rate limit
  IF v_raw_ip IS NULL OR v_raw_ip = '' THEN
    RETURN TRUE;
  END IF;

  -- Hash the IP for GDPR compliance
  v_ip_hash := encode(digest(v_raw_ip, 'sha256'), 'hex');

  -- Current 1-minute window
  v_window := date_trunc('minute', now());

  -- Prune windows older than 2 minutes (cheap: only the oldest rows qualify)
  DELETE FROM public.guest_link_rate_limit
  WHERE window_start < (v_window - INTERVAL '2 minutes');

  -- Upsert: insert or increment the counter for this window
  INSERT INTO public.guest_link_rate_limit (ip_hash, window_start, request_count)
  VALUES (v_ip_hash, v_window, 1)
  ON CONFLICT (ip_hash, window_start)
  DO UPDATE SET request_count = guest_link_rate_limit.request_count + 1
  RETURNING request_count INTO v_count;

  RETURN v_count <= p_max_requests_per_minute;
END;
$$;

REVOKE ALL    ON FUNCTION public.enforce_guest_link_rate_limit(INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enforce_guest_link_rate_limit(INTEGER) TO anon;
GRANT EXECUTE ON FUNCTION public.enforce_guest_link_rate_limit(INTEGER) TO authenticated;

COMMENT ON FUNCTION public.enforce_guest_link_rate_limit(INTEGER) IS
  'Per-IP rate-limit check for guest link RPCs. '
  'Tracks request counts per (SHA-256(ip), UTC-minute) window. '
  'Returns TRUE if within budget, FALSE if limit exceeded. '
  'Fail-open when IP is unavailable (backend/Edge Function calls). '
  '2026-04 hardening.';


-- ─── 3. Patch get_guest_link_info — add rate-limit check ─────────────────────

CREATE OR REPLACE FUNCTION public.get_guest_link_info(p_link_id UUID)
RETURNS TABLE (
  id                    UUID,
  label                 TEXT,
  agency_name           TEXT,
  type                  TEXT,
  is_active             BOOLEAN,
  expires_at            TIMESTAMPTZ,
  tos_accepted_by_guest BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Rate-limit: 60 requests per minute per IP (GDPR: IP hashed before storage)
  IF NOT public.enforce_guest_link_rate_limit(60) THEN
    RAISE EXCEPTION 'rate_limit_exceeded'
      USING HINT = 'Too many requests. Please wait before retrying.',
            ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
  SELECT
    gl.id,
    gl.label,
    gl.agency_name,
    gl.type::TEXT,
    gl.is_active,
    gl.expires_at,
    gl.tos_accepted_by_guest
  FROM public.guest_links gl
  WHERE gl.id         = p_link_id
    AND gl.is_active  = true
    AND gl.deleted_at IS NULL
    AND (gl.expires_at IS NULL OR gl.expires_at > now());
END;
$$;

REVOKE ALL    ON FUNCTION public.get_guest_link_info(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_guest_link_info(UUID) TO anon;
GRANT EXECUTE ON FUNCTION public.get_guest_link_info(UUID) TO authenticated;

COMMENT ON FUNCTION public.get_guest_link_info(UUID) IS
  'Returns display-safe metadata for a single active, non-expired, non-deleted guest link. '
  'Enforces 60 req/min per-IP rate limit (2026-04 hardening). '
  'Does NOT expose agency_id or model_ids. Safe for anon callers.';


-- ─── 4. Patch get_guest_link_models — add rate-limit check ───────────────────

CREATE OR REPLACE FUNCTION public.get_guest_link_models(p_link_id UUID)
RETURNS TABLE (
  id               UUID,
  name             TEXT,
  height           INTEGER,
  bust             INTEGER,
  waist            INTEGER,
  hips             INTEGER,
  city             TEXT,
  hair_color       TEXT,
  eye_color        TEXT,
  sex              TEXT,
  portfolio_images TEXT[],
  polaroids        TEXT[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_model_ids UUID[];
  v_type      TEXT;
  v_agency_id UUID;
BEGIN
  -- Rate-limit: 30 requests per minute per IP (heavier query — tighter budget)
  IF NOT public.enforce_guest_link_rate_limit(30) THEN
    RAISE EXCEPTION 'rate_limit_exceeded'
      USING HINT = 'Too many requests. Please wait before retrying.',
            ERRCODE = 'P0001';
  END IF;

  -- Validate the link: active, not expired, not deleted (VULN-C1 fix)
  SELECT gl.model_ids, gl.type, gl.agency_id
    INTO v_model_ids, v_type, v_agency_id
    FROM public.guest_links gl
   WHERE gl.id         = p_link_id
     AND gl.is_active  = true
     AND gl.deleted_at IS NULL
     AND (gl.expires_at IS NULL OR gl.expires_at > now());

  IF NOT FOUND THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    m.id,
    m.name,
    m.height,
    m.bust,
    m.waist,
    m.hips,
    m.city,
    m.hair_color,
    m.eye_color,
    m.sex::TEXT,
    CASE WHEN v_type = 'portfolio' THEN COALESCE(m.portfolio_images, '{}') ELSE '{}' END,
    CASE WHEN v_type = 'polaroid'  THEN COALESCE(m.polaroids, '{}')        ELSE '{}' END
  FROM public.models m
  WHERE m.id        = ANY(v_model_ids)
    AND m.agency_id = v_agency_id;  -- H-4 fix: prevents cross-agency data leakage
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_guest_link_models(UUID) TO anon;
GRANT EXECUTE ON FUNCTION public.get_guest_link_models(UUID) TO authenticated;

COMMENT ON FUNCTION public.get_guest_link_models(UUID) IS
  'Returns model fields for an active guest link (portfolio or polaroid type). '
  'Enforces 30 req/min per-IP rate limit (2026-04 hardening). '
  'H-4 fix: m.agency_id = link.agency_id prevents cross-agency leakage. '
  'VULN-C1 fix: deleted_at IS NULL guard. SECURITY DEFINER — safe for anon.';
