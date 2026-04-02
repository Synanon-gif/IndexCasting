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
