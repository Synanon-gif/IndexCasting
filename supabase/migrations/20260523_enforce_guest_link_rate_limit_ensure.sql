-- =============================================================================
-- Ensure enforce_guest_link_rate_limit exists on Live (dependency of
-- get_guest_link_info / get_guest_link_models). Root SQL existed only outside
-- migrations/; without this helper PostgREST returns 404 with 42883 inside.
-- Idempotent. Uses PG13+ sha256(bytea) — no pgcrypto digest().
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.guest_link_rate_limit (
  ip_hash       TEXT        NOT NULL,
  window_start  TIMESTAMPTZ NOT NULL,
  request_count INTEGER     NOT NULL DEFAULT 1,
  PRIMARY KEY (ip_hash, window_start)
);

CREATE INDEX IF NOT EXISTS idx_guest_link_rate_limit_window
  ON public.guest_link_rate_limit (window_start);

ALTER TABLE public.guest_link_rate_limit ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.guest_link_rate_limit IS
  'Per-IP rate-limit counters for guest link RPCs (SHA-256(ip), UTC minute).';

CREATE OR REPLACE FUNCTION public.enforce_guest_link_rate_limit(
  p_max_requests_per_minute INTEGER DEFAULT 60
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_raw_ip      TEXT;
  v_ip_hash     TEXT;
  v_window      TIMESTAMPTZ;
  v_count       INTEGER;
BEGIN
  BEGIN
    v_raw_ip := current_setting('request.headers', true)::json->>'x-forwarded-for';
  EXCEPTION WHEN OTHERS THEN
    v_raw_ip := NULL;
  END;

  IF v_raw_ip IS NOT NULL THEN
    v_raw_ip := split_part(trim(v_raw_ip), ',', 1);
  END IF;

  IF v_raw_ip IS NULL OR v_raw_ip = '' THEN
    RETURN TRUE;
  END IF;

  v_ip_hash := encode(sha256(convert_to(v_raw_ip, 'UTF8')), 'hex');

  v_window := date_trunc('minute', now());

  DELETE FROM public.guest_link_rate_limit
  WHERE window_start < (v_window - INTERVAL '2 minutes');

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
  'Per-IP rate-limit for guest link RPCs. 20260523 migration — sha256 (no pgcrypto).';

NOTIFY pgrst, 'reload schema';
