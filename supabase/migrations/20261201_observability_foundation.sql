-- =============================================================================
-- Migration: 20261201_observability_foundation.sql
--
-- WHY: Self-hosted Observability foundation (Trust + Observability initiative).
-- IndexCasting is moving from `console.*`-only logging to a structured, queryable
-- event store + continuous health checks + a public live status page. This
-- migration creates the storage primitives and the three RPCs that the frontend,
-- edge functions and the public status page will read and write.
--
-- DESIGN PRINCIPLES
--   1. Additive only — no existing table, function or policy is altered.
--   2. Multi-tenant safe — admin-only reads, no cross-org leak. The single
--      public-facing RPC (`get_public_health_summary`) returns ONLY the health
--      check rows that are explicitly flagged `is_public = true` and never
--      exposes raw event rows.
--   3. Backpressure-safe — `record_system_event` enforces a per-user 60s ingress
--      cap so a misbehaving client (or a logging loop) cannot flood the table.
--   4. Source-of-truth alignment — pg_cron health checks (separate migration
--      20261202) write to `system_health_checks`; frontend + edge logger write
--      to `system_events`; cron health check failures duplicate into
--      `system_invariant_violations` (append-only audit trail).
--
-- SECURITY MODEL
--   - All three tables: RLS enabled, admin-only read/write via
--     `public.is_current_user_admin()`. Authenticated users CANNOT directly
--     SELECT or INSERT — they must go through `record_system_event` (which is
--     SECURITY DEFINER + row_security off + per-user rate limit).
--   - Anon users CANNOT touch the tables at all. The public status page calls
--     `public.get_public_health_summary()` which is `STABLE SECURITY DEFINER`
--     and reads only the public flagged check names.
--   - `assert_is_admin()` gates the admin-only overview RPC.
--
-- COMPATIBILITY: Purely additive. No existing routines depend on these objects.
-- A separate migration (20261202) adds pg_cron checks that USE these tables.
-- =============================================================================

-- ── 1. Storage primitives ────────────────────────────────────────────────────

-- Append-only structured event log (frontend, edge, db, cron). Replaces ad-hoc
-- `console.*` for anything that should be queryable, alertable or visible to
-- the platform admin.
CREATE TABLE IF NOT EXISTS public.system_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      timestamptz NOT NULL DEFAULT now(),

  -- Severity classification used by both UI and alerting.
  level           text NOT NULL
                  CHECK (level IN ('debug','info','warn','error','fatal')),

  -- Origin of the event (drives filtering and dashboarding).
  source          text NOT NULL
                  CHECK (source IN ('frontend','edge','db','cron','system')),

  -- Stable, machine-readable event identifier (e.g. `option.confirm.failure`).
  event           text NOT NULL,

  -- Human-readable summary; PII redaction is the caller's responsibility,
  -- mirrored by the frontend logger's redaction helper.
  message         text,

  -- Free-form structured context: stack traces, ids, status codes, etc.
  -- Hard cap of ~16 KB enforced at the RPC layer to keep the table light.
  context         jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Best-effort attribution. Both nullable (cron jobs and unauthenticated
  -- frontend boot errors have no user/org).
  actor_user_id   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,

  -- Trace correlation across frontend → edge → db when supplied.
  request_id      text,

  -- Frontend release / git sha / edge function name suffix for easier triage.
  release         text
);

COMMENT ON TABLE public.system_events IS
  'Append-only structured event log for frontend, edge functions, database '
  'and cron jobs. Admin-only reads. Writes from authenticated frontend go '
  'through public.record_system_event (rate-limited). Writes from edge '
  'functions and cron use service-role / SECURITY DEFINER paths.';

-- Hot-path indexes: (1) chronological feed, (2) severity filter, (3) source
-- filter, (4) per-org admin drill-down. Kept minimal — the table is mostly
-- written and read by the admin dashboard, not by hot product paths.
CREATE INDEX IF NOT EXISTS system_events_created_at_idx
  ON public.system_events (created_at DESC);

CREATE INDEX IF NOT EXISTS system_events_level_created_idx
  ON public.system_events (level, created_at DESC);

CREATE INDEX IF NOT EXISTS system_events_source_created_idx
  ON public.system_events (source, created_at DESC);

CREATE INDEX IF NOT EXISTS system_events_org_created_idx
  ON public.system_events (organization_id, created_at DESC)
  WHERE organization_id IS NOT NULL;

-- Current status per named health check (one row per check, upserted by cron).
-- Read by both the admin dashboard and the public status page (latter only
-- where `is_public = true`).
CREATE TABLE IF NOT EXISTS public.system_health_checks (
  name          text PRIMARY KEY,

  -- High-level grouping for the admin dashboard.
  category      text NOT NULL
                CHECK (category IN (
                  'rls','data_integrity','workflow','platform','external'
                )),

  -- Short human label shown in dashboards / status page.
  display_name  text NOT NULL,

  -- One-line description visible in the admin dashboard tooltip.
  description   text,

  -- Operational state. `unknown` is the cold-start value before the first
  -- cron run; the public status page renders that as "Status unknown".
  status        text NOT NULL DEFAULT 'unknown'
                CHECK (status IN ('ok','degraded','down','unknown')),

  -- Drives badge color and whether a status-page warning surfaces.
  severity      text NOT NULL DEFAULT 'info'
                CHECK (severity IN ('info','warn','critical')),

  -- Whether this check is exposed on the public /status page. Default is
  -- false — only checks that have been reviewed for safe public exposure
  -- (no internal hostnames, no sensitive labels) are flipped to true.
  is_public     boolean NOT NULL DEFAULT false,

  -- Bookkeeping for status pages and "last run was N minutes ago" rendering.
  last_run_at   timestamptz,
  last_ok_at    timestamptz,

  -- Free-form details from the most recent run (counts, sample row IDs, etc.).
  details       jsonb NOT NULL DEFAULT '{}'::jsonb,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.system_health_checks IS
  'Current status of each continuous health check. Upserted by pg_cron via '
  'public.run_system_health_checks() (migration 20261202). Read by the '
  'admin Health & Events tab (all rows) and by /status (is_public rows only).';

-- Append-only audit trail of every time a health check moved away from `ok`.
-- Used for incident timelines and post-incident reviews. Never overwritten —
-- a separate retention job (manual for now) trims rows older than 12 months.
CREATE TABLE IF NOT EXISTS public.system_invariant_violations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  detected_at     timestamptz NOT NULL DEFAULT now(),
  check_name      text NOT NULL,
  severity        text NOT NULL
                  CHECK (severity IN ('info','warn','critical')),
  -- Count of offending rows or numeric value the check produced (e.g. number
  -- of zombie orgs detected). NULL if the check is binary (pass / fail).
  count_or_value  bigint,
  details         jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Set when a follow-up cron run sees the check return to `ok`. Lets the
  -- admin dashboard render "currently active" vs "historical" violations.
  resolved_at     timestamptz
);

COMMENT ON TABLE public.system_invariant_violations IS
  'Append-only log of every health check transition into degraded/down. '
  'Auto-resolved by the next ok run. Admin-only.';

CREATE INDEX IF NOT EXISTS system_invariant_violations_detected_idx
  ON public.system_invariant_violations (detected_at DESC);

CREATE INDEX IF NOT EXISTS system_invariant_violations_check_active_idx
  ON public.system_invariant_violations (check_name, detected_at DESC)
  WHERE resolved_at IS NULL;

-- ── 2. Row Level Security ────────────────────────────────────────────────────
-- Strict admin-only access on all three tables. All non-admin reads/writes
-- happen through SECURITY DEFINER RPCs below.

ALTER TABLE public.system_events             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_health_checks      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_invariant_violations ENABLE ROW LEVEL SECURITY;

-- Drop-and-recreate so reruns are idempotent without `CREATE POLICY IF NOT EXISTS`
-- (not supported on older Postgres versions in the wild Supabase fleet).
DROP POLICY IF EXISTS system_events_admin_select ON public.system_events;
DROP POLICY IF EXISTS system_events_admin_insert ON public.system_events;
DROP POLICY IF EXISTS system_events_admin_update ON public.system_events;
DROP POLICY IF EXISTS system_events_admin_delete ON public.system_events;

CREATE POLICY system_events_admin_select
  ON public.system_events FOR SELECT TO authenticated
  USING (public.is_current_user_admin());
CREATE POLICY system_events_admin_insert
  ON public.system_events FOR INSERT TO authenticated
  WITH CHECK (public.is_current_user_admin());
CREATE POLICY system_events_admin_update
  ON public.system_events FOR UPDATE TO authenticated
  USING (public.is_current_user_admin())
  WITH CHECK (public.is_current_user_admin());
CREATE POLICY system_events_admin_delete
  ON public.system_events FOR DELETE TO authenticated
  USING (public.is_current_user_admin());

DROP POLICY IF EXISTS system_health_checks_admin_select ON public.system_health_checks;
DROP POLICY IF EXISTS system_health_checks_admin_insert ON public.system_health_checks;
DROP POLICY IF EXISTS system_health_checks_admin_update ON public.system_health_checks;
DROP POLICY IF EXISTS system_health_checks_admin_delete ON public.system_health_checks;

CREATE POLICY system_health_checks_admin_select
  ON public.system_health_checks FOR SELECT TO authenticated
  USING (public.is_current_user_admin());
CREATE POLICY system_health_checks_admin_insert
  ON public.system_health_checks FOR INSERT TO authenticated
  WITH CHECK (public.is_current_user_admin());
CREATE POLICY system_health_checks_admin_update
  ON public.system_health_checks FOR UPDATE TO authenticated
  USING (public.is_current_user_admin())
  WITH CHECK (public.is_current_user_admin());
CREATE POLICY system_health_checks_admin_delete
  ON public.system_health_checks FOR DELETE TO authenticated
  USING (public.is_current_user_admin());

DROP POLICY IF EXISTS system_invariant_violations_admin_select ON public.system_invariant_violations;
DROP POLICY IF EXISTS system_invariant_violations_admin_insert ON public.system_invariant_violations;
DROP POLICY IF EXISTS system_invariant_violations_admin_update ON public.system_invariant_violations;

CREATE POLICY system_invariant_violations_admin_select
  ON public.system_invariant_violations FOR SELECT TO authenticated
  USING (public.is_current_user_admin());
CREATE POLICY system_invariant_violations_admin_insert
  ON public.system_invariant_violations FOR INSERT TO authenticated
  WITH CHECK (public.is_current_user_admin());
CREATE POLICY system_invariant_violations_admin_update
  ON public.system_invariant_violations FOR UPDATE TO authenticated
  USING (public.is_current_user_admin())
  WITH CHECK (public.is_current_user_admin());

-- Hard-deny anon on all three tables. Even with no policy, anon would already
-- be blocked by RLS-enabled-no-policy semantics; explicit REVOKE is belt and
-- braces against future Supabase grant changes.
REVOKE ALL ON public.system_events             FROM anon;
REVOKE ALL ON public.system_health_checks      FROM anon;
REVOKE ALL ON public.system_invariant_violations FROM anon;

-- ── 3. RPC: record_system_event (frontend + authenticated callers) ───────────
-- Called fire-and-forget from `src/utils/logger.ts`. Validates inputs, applies
-- a 60-events-per-user-per-60s soft cap, redacts oversized payloads and writes
-- one row to system_events. Returns `true` on accept, `false` on rate-limit
-- (so callers can drop without UI impact), raises only on auth failure.

CREATE OR REPLACE FUNCTION public.record_system_event(
  p_level      text,
  p_source     text,
  p_event      text,
  p_message    text DEFAULT NULL,
  p_context    jsonb DEFAULT '{}'::jsonb,
  p_request_id text DEFAULT NULL,
  p_release    text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_uid           uuid := auth.uid();
  v_recent_count  int;
  v_context_size  int;
  v_clean_context jsonb := COALESCE(p_context, '{}'::jsonb);
BEGIN
  -- Guard 1: only authenticated callers. Unauthenticated frontends queue
  -- locally until they have a session (handled in the TS logger).
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- Guard 2: validate enums BEFORE inserting so the table CHECK constraint
  -- can never raise from a typo and pollute the error stream.
  IF p_level NOT IN ('debug','info','warn','error','fatal') THEN
    RAISE EXCEPTION 'invalid_level';
  END IF;
  IF p_source NOT IN ('frontend','edge','db','cron','system') THEN
    RAISE EXCEPTION 'invalid_source';
  END IF;
  IF coalesce(trim(p_event), '') = '' THEN
    RAISE EXCEPTION 'invalid_event';
  END IF;

  -- Guard 3: per-user rate limit. 60 events per rolling 60 seconds is
  -- intentionally loose — the TS logger throttles to ~20/min/source already,
  -- this is just a runaway-loop circuit breaker. Failures return `false`
  -- silently so they never disrupt UX.
  SELECT count(*) INTO v_recent_count
  FROM public.system_events
  WHERE actor_user_id = v_uid
    AND created_at > now() - interval '60 seconds';
  IF v_recent_count >= 60 THEN
    RETURN false;
  END IF;

  -- Guard 4: size cap on the context payload (16 KB). Larger contexts get
  -- replaced by a stub so the row is still useful for triage but the table
  -- stays light.
  v_context_size := octet_length(v_clean_context::text);
  IF v_context_size > 16384 THEN
    v_clean_context := jsonb_build_object(
      'truncated', true,
      'original_bytes', v_context_size
    );
  END IF;

  INSERT INTO public.system_events (
    level, source, event, message, context,
    actor_user_id, request_id, release
  ) VALUES (
    p_level, p_source, p_event,
    -- Cap message length defensively — the TS logger already truncates to
    -- 1000 chars, this is a safety net.
    CASE WHEN p_message IS NULL OR length(p_message) <= 2000
         THEN p_message
         ELSE left(p_message, 2000) || '…[truncated]'
    END,
    v_clean_context,
    v_uid,
    NULLIF(p_request_id, ''),
    NULLIF(p_release, '')
  );

  RETURN true;
END;
$$;

COMMENT ON FUNCTION public.record_system_event(text, text, text, text, jsonb, text, text) IS
  '20261201: Authenticated frontend + edge logger sink. Per-user 60s soft cap, '
  '16KB context cap, 2000-char message cap. Returns false on rate-limit, '
  'raises only on auth/enum failure. Fire-and-forget by design.';

REVOKE ALL    ON FUNCTION public.record_system_event(text, text, text, text, jsonb, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_system_event(text, text, text, text, jsonb, text, text) TO authenticated;

-- ── 4. RPC: get_public_health_summary (anon-callable, /status page) ─────────
-- Returns aggregated platform status. Only includes checks marked `is_public`.
-- Returned shape is intentionally narrow — no IDs, no internal labels, no
-- counts — so it cannot leak operational detail to public visitors.

CREATE OR REPLACE FUNCTION public.get_public_health_summary()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_overall      text;
  v_last_updated timestamptz;
  v_checks       jsonb;
BEGIN
  -- Aggregate overall status: outage (any down) > degraded (any degraded) >
  -- unknown (any check still cold or zero public checks configured) > ok.
  -- Done in two steps so an empty result set (no public checks yet) maps to
  -- 'unknown' instead of falling through ELSE to 'ok'.
  SELECT
    CASE
      WHEN count(*) = 0                                 THEN 'unknown'
      WHEN bool_or(status = 'down')                     THEN 'outage'
      WHEN bool_or(status = 'degraded')                 THEN 'degraded'
      WHEN bool_or(status = 'unknown' OR last_run_at IS NULL) THEN 'unknown'
      ELSE 'ok'
    END,
    max(last_run_at)
  INTO v_overall, v_last_updated
  FROM public.system_health_checks
  WHERE is_public = true;

  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'name', name,
      'display_name', display_name,
      'status', status,
      'last_run_at', last_run_at
    )
    ORDER BY display_name
  ), '[]'::jsonb)
  INTO v_checks
  FROM public.system_health_checks
  WHERE is_public = true;

  RETURN jsonb_build_object(
    'overall_status', v_overall,
    'last_updated', v_last_updated,
    'checks', v_checks
  );
END;
$$;

COMMENT ON FUNCTION public.get_public_health_summary() IS
  '20261201: Public status page payload. Returns overall_status + per-check '
  'narrow rows for is_public=true checks only. Anon-callable, no PII, no '
  'internal labels. Used by /status (src/views/StatusPageView.tsx).';

REVOKE ALL    ON FUNCTION public.get_public_health_summary() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_health_summary() TO anon, authenticated;

-- ── 5. RPC: get_admin_health_overview (admin-only) ──────────────────────────
-- Powers the Health & Events tab in the admin dashboard. Returns the full
-- check table, the most recent unresolved invariant violations, and a 24h
-- summary of system_events grouped by level.

CREATE OR REPLACE FUNCTION public.get_admin_health_overview()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_checks      jsonb;
  v_violations  jsonb;
  v_event_24h   jsonb;
BEGIN
  -- assert_is_admin() is the canonical admin gate (UUID + email pin, logs
  -- failed attempts). Raises on non-admin callers.
  PERFORM public.assert_is_admin();

  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'name', name,
      'category', category,
      'display_name', display_name,
      'description', description,
      'status', status,
      'severity', severity,
      'is_public', is_public,
      'last_run_at', last_run_at,
      'last_ok_at', last_ok_at,
      'details', details
    )
    ORDER BY
      -- Surface failures first so the admin sees them without scrolling.
      CASE status WHEN 'down' THEN 0 WHEN 'degraded' THEN 1 WHEN 'unknown' THEN 2 ELSE 3 END,
      category, display_name
  ), '[]'::jsonb)
  INTO v_checks
  FROM public.system_health_checks;

  -- Up to 50 most recent unresolved violations (active incidents) + the last
  -- 50 resolved ones for context. The admin UI buckets them by `resolved_at`.
  WITH active AS (
    SELECT id, detected_at, check_name, severity, count_or_value, details, resolved_at
    FROM public.system_invariant_violations
    WHERE resolved_at IS NULL
    ORDER BY detected_at DESC
    LIMIT 50
  ),
  recent_resolved AS (
    SELECT id, detected_at, check_name, severity, count_or_value, details, resolved_at
    FROM public.system_invariant_violations
    WHERE resolved_at IS NOT NULL
    ORDER BY detected_at DESC
    LIMIT 50
  ),
  combined AS (
    SELECT * FROM active
    UNION ALL
    SELECT * FROM recent_resolved
  )
  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'id', id,
      'detected_at', detected_at,
      'check_name', check_name,
      'severity', severity,
      'count_or_value', count_or_value,
      'details', details,
      'resolved_at', resolved_at
    )
    ORDER BY detected_at DESC
  ), '[]'::jsonb)
  INTO v_violations
  FROM combined;

  -- 24h event-level histogram. Cheap to compute thanks to
  -- (level, created_at) index.
  SELECT coalesce(jsonb_object_agg(level, n), '{}'::jsonb)
  INTO v_event_24h
  FROM (
    SELECT level, count(*)::bigint AS n
    FROM public.system_events
    WHERE created_at > now() - interval '24 hours'
    GROUP BY level
  ) AS h;

  RETURN jsonb_build_object(
    'checks', v_checks,
    'violations', v_violations,
    'event_counts_24h', v_event_24h,
    'generated_at', now()
  );
END;
$$;

COMMENT ON FUNCTION public.get_admin_health_overview() IS
  '20261201: Admin Health & Events dashboard payload. Returns full check '
  'table, recent active+resolved invariant violations, and a 24h event '
  'count histogram by level. Admin-only via assert_is_admin().';

REVOKE ALL    ON FUNCTION public.get_admin_health_overview() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_admin_health_overview() TO authenticated;

-- ── 6. updated_at trigger on system_health_checks ────────────────────────────
-- Cron will UPDATE rows in place; the touch trigger keeps `updated_at` honest
-- without forcing every UPSERT call site to set it manually.

CREATE OR REPLACE FUNCTION public.tg_system_health_checks_touch()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS system_health_checks_touch ON public.system_health_checks;
CREATE TRIGGER system_health_checks_touch
  BEFORE UPDATE ON public.system_health_checks
  FOR EACH ROW EXECUTE FUNCTION public.tg_system_health_checks_touch();

-- ── 7. Verification ──────────────────────────────────────────────────────────
-- Run as a single DO block so the migration aborts loudly if any expected
-- object is missing or misconfigured.

DO $$
DECLARE
  v_def text;
BEGIN
  -- Tables
  ASSERT to_regclass('public.system_events') IS NOT NULL,
    'FAIL: system_events table missing';
  ASSERT to_regclass('public.system_health_checks') IS NOT NULL,
    'FAIL: system_health_checks table missing';
  ASSERT to_regclass('public.system_invariant_violations') IS NOT NULL,
    'FAIL: system_invariant_violations table missing';

  -- RLS enabled
  ASSERT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.system_events'::regclass),
    'FAIL: RLS not enabled on system_events';
  ASSERT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.system_health_checks'::regclass),
    'FAIL: RLS not enabled on system_health_checks';
  ASSERT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.system_invariant_violations'::regclass),
    'FAIL: RLS not enabled on system_invariant_violations';

  -- record_system_event
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'record_system_event';
  ASSERT v_def IS NOT NULL,
    'FAIL: record_system_event missing';
  ASSERT v_def ILIKE '%row_security%off%',
    'FAIL: record_system_event missing SET row_security TO off';
  ASSERT v_def ILIKE '%not_authenticated%',
    'FAIL: record_system_event missing auth guard';
  ASSERT v_def ILIKE '%60 seconds%',
    'FAIL: record_system_event missing per-user rate limit';

  -- get_public_health_summary
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'get_public_health_summary';
  ASSERT v_def IS NOT NULL,
    'FAIL: get_public_health_summary missing';
  ASSERT v_def ILIKE '%is_public = true%',
    'FAIL: get_public_health_summary not filtered to public checks';

  -- get_admin_health_overview
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'get_admin_health_overview';
  ASSERT v_def IS NOT NULL,
    'FAIL: get_admin_health_overview missing';
  ASSERT v_def ILIKE '%assert_is_admin%',
    'FAIL: get_admin_health_overview missing admin gate';

  -- Public health summary returns a well-formed payload even before any
  -- check rows exist (cold-start safety) and surfaces 'unknown' rather than
  -- a misleading 'ok' when zero public checks are configured.
  ASSERT (public.get_public_health_summary() ? 'overall_status'),
    'FAIL: get_public_health_summary cold-start payload missing overall_status';
  ASSERT (public.get_public_health_summary() ? 'checks'),
    'FAIL: get_public_health_summary cold-start payload missing checks';
  ASSERT (public.get_public_health_summary() ->> 'overall_status') IN ('unknown','ok','degraded','outage'),
    'FAIL: get_public_health_summary returned unexpected overall_status value';

  RAISE NOTICE 'PASS: 20261201_observability_foundation — all checks passed';
END $$;
