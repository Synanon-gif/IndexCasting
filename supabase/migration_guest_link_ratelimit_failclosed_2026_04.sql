-- =============================================================================
-- Guest Link Rate Limit – Fail-Closed Fix  (2026-04 Security Hardening)
--
-- Problem: enforce_guest_link_rate_limit() returned TRUE (allow) when the
--   caller IP could not be extracted from request.headers.  This meant that
--   direct DB connections, manipulated headers, or Edge Function proxies
--   could bypass the per-IP budget entirely.
--
-- Fix: use the sentinel bucket '__no_ip__' instead of skipping the check.
--   All requests without a resolvable IP share a single tight budget
--   (10 req/min by default when called from get_guest_link_info/models).
--   Admin / backend Edge Function calls hit the sentinel bucket; they are
--   expected to be low-frequency and well within the budget.
--
-- Idempotent – safe to run multiple times.
-- Run AFTER migration_guest_link_rate_limit.sql.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.enforce_guest_link_rate_limit(
  p_max_requests_per_minute INTEGER DEFAULT 60
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_raw_ip  TEXT;
  v_ip_hash TEXT;
  v_window  TIMESTAMPTZ;
  v_count   INTEGER;
BEGIN
  -- Extract caller IP from PostgREST request headers.
  -- Available when the function is called through the REST API; NULL when
  -- called from a direct DB connection or a server-side Edge Function.
  BEGIN
    v_raw_ip := current_setting('request.headers', true)::json->>'x-forwarded-for';
  EXCEPTION WHEN OTHERS THEN
    v_raw_ip := NULL;
  END;

  -- Trim to the first IP in X-Forwarded-For (may be comma-separated list).
  IF v_raw_ip IS NOT NULL THEN
    v_raw_ip := split_part(trim(v_raw_ip), ',', 1);
  END IF;

  -- Fail-CLOSED: when no IP can be resolved, apply a tight shared sentinel
  -- bucket instead of skipping the check.  This prevents IP-header stripping
  -- as a bypass technique and keeps backend/Edge Function calls auditable.
  IF v_raw_ip IS NULL OR trim(v_raw_ip) = '' THEN
    v_raw_ip := '__no_ip__';
  END IF;

  -- Hash the IP for GDPR compliance (SHA-256, hex-encoded).
  v_ip_hash := encode(digest(v_raw_ip, 'sha256'), 'hex');

  -- Current 1-minute window.
  v_window := date_trunc('minute', now());

  -- Prune rows older than 2 minutes (only a handful ever qualify).
  DELETE FROM public.guest_link_rate_limit
  WHERE window_start < (v_window - INTERVAL '2 minutes');

  -- Upsert: insert or increment the counter for this (ip_hash, window).
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
  'FAIL-CLOSED: unresolvable IPs fall into a shared __no_ip__ sentinel bucket '
  'instead of bypassing the check (2026-04 fail-closed patch).';
