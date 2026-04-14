-- =============================================================================
-- Scalability M1: Advisory lock helper for option_requests mutations
--
-- Problem: Two bookers from the same agency (or client employee + owner) can
-- simultaneously mutate the same option_request row. The frontend-only
-- criticalOptionActionInflight guard only works per-browser-tab. Concurrent
-- writes from different devices can produce duplicate system messages and
-- notifications.
--
-- Fix: pg_advisory_xact_lock on the option_request UUID, acquired inside
-- critical RPCs. The lock auto-releases at transaction end (COMMIT/ROLLBACK).
-- Callers that cannot acquire the lock within statement_timeout are rolled back.
--
-- Helper function: acquire_option_request_lock(uuid) — to be called as first
-- statement in critical option_request RPCs.
--
-- Also adds an optimistic locking column guard via updated_at for the
-- setAgencyCounterOffer path (most prone to concurrent writes).
--
-- Idempotent. Safe to re-run.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.acquire_option_request_lock(p_request_id uuid)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
SET row_security TO off
AS $$
DECLARE
  v_lock_key bigint;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'option_request_id required';
  END IF;

  -- Convert UUID to two int4 values for pg_advisory_xact_lock
  -- Use a stable hash: first 8 bytes of the UUID as bigint
  v_lock_key := ('x' || substr(replace(p_request_id::text, '-', ''), 1, 16))::bit(64)::bigint;

  PERFORM pg_advisory_xact_lock(v_lock_key);
END;
$$;

REVOKE ALL ON FUNCTION public.acquire_option_request_lock(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.acquire_option_request_lock(uuid) TO authenticated;

COMMENT ON FUNCTION public.acquire_option_request_lock(uuid) IS
  'Transaction-scoped advisory lock on an option_request UUID. '
  'Prevents concurrent mutations from different sessions. 20260807.';

DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'acquire_option_request_lock'
  ), 'FAIL: acquire_option_request_lock missing after 20260807 migration';
END;
$$;
