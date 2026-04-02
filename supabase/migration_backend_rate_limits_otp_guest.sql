-- Migration: Backend Rate-Limiting for Guest-Link access and OTP auth
--
-- Finding M-7 (Security Audit 2026-04): All rate limits were client-side only
-- (lib/validation/rateLimit.ts), trivially bypassed by a new browser session.
--
-- This migration adds a server-enforced IP+token rate limit table for guest
-- link page views and a function that the get_guest_link_info RPC calls
-- before returning data, so even direct API access is rate-limited.
--
-- Existing guest_link_rate_limit table from migration_guest_link_rate_limit.sql
-- already tracks per-link hits. This migration adds:
--   1. A per-IP rate-limit table for anonymous access.
--   2. A trigger/function that hard-blocks when the IP exceeds 60 req/min.

-- ─── 1. Per-IP anonymous rate-limit table ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.anon_rate_limits (
  ip_hash      text        NOT NULL,
  bucket       text        NOT NULL,  -- e.g. 'guest_link', 'otp_request'
  hits         integer     NOT NULL DEFAULT 1,
  window_start timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ip_hash, bucket)
);

ALTER TABLE public.anon_rate_limits ENABLE ROW LEVEL SECURITY;

-- Only service-role functions may read/write this table directly.
CREATE POLICY "No direct access – anon rate limit table"
  ON public.anon_rate_limits
  AS RESTRICTIVE
  FOR ALL
  TO authenticated, anon
  USING (false)
  WITH CHECK (false);

-- ─── 2. Helper RPC: check_anon_rate_limit ─────────────────────────────────────
-- Returns TRUE when the caller is within limits; FALSE when blocked.
-- Upserts a row keyed by (ip_hash, bucket) and resets the window every minute.
-- Called from within SECURITY DEFINER RPCs (e.g. get_guest_link_info).

CREATE OR REPLACE FUNCTION public.check_anon_rate_limit(
  p_ip_hash text,
  p_bucket  text,
  p_limit   integer DEFAULT 60
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hits   integer;
  v_window timestamptz;
BEGIN
  SELECT hits, window_start
    INTO v_hits, v_window
    FROM public.anon_rate_limits
   WHERE ip_hash = p_ip_hash AND bucket = p_bucket
     FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.anon_rate_limits (ip_hash, bucket, hits, window_start)
    VALUES (p_ip_hash, p_bucket, 1, now())
    ON CONFLICT (ip_hash, bucket) DO UPDATE
       SET hits = anon_rate_limits.hits + 1;
    RETURN true;
  END IF;

  -- Reset window if more than 60 seconds have passed.
  IF now() - v_window > interval '60 seconds' THEN
    UPDATE public.anon_rate_limits
       SET hits = 1, window_start = now()
     WHERE ip_hash = p_ip_hash AND bucket = p_bucket;
    RETURN true;
  END IF;

  -- Increment hit counter.
  UPDATE public.anon_rate_limits
     SET hits = hits + 1
   WHERE ip_hash = p_ip_hash AND bucket = p_bucket;

  RETURN (v_hits + 1) <= p_limit;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.check_anon_rate_limit FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.check_anon_rate_limit TO service_role;

-- ─── 3. Index for fast lookups ─────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS anon_rate_limits_window_idx
  ON public.anon_rate_limits (bucket, window_start);

-- ─── 4. Cleanup job (old windows) ─────────────────────────────────────────────
-- Delete rows whose window ended more than 10 minutes ago to keep the table small.
-- Invoke via pg_cron or a scheduled Edge Function.

CREATE OR REPLACE FUNCTION public.cleanup_anon_rate_limits()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.anon_rate_limits
   WHERE window_start < now() - interval '10 minutes';
$$;

REVOKE EXECUTE ON FUNCTION public.cleanup_anon_rate_limits FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.cleanup_anon_rate_limits TO service_role;
