-- =============================================================================
-- Ensure get_guest_link_info exists on Live (fixes PostgREST 404 on RPC).
-- Re-applies the same definition as 20260406_guest_link_first_access_7day_window.sql
-- (validity: is_active, deleted_at, first_accessed_at 7-day window, expires_at).
-- Depends on: enforce_guest_link_rate_limit(INTEGER), guest_links.first_accessed_at.
-- Idempotent. Safe to re-run.
-- =============================================================================

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
SET row_security TO off
AS $$
BEGIN
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
  WHERE gl.id        = p_link_id
    AND gl.is_active = true
    AND gl.deleted_at IS NULL
    AND (
      (gl.first_accessed_at IS NULL
        AND (gl.expires_at IS NULL OR gl.expires_at > now()))
      OR
      (gl.first_accessed_at IS NOT NULL
        AND gl.first_accessed_at + INTERVAL '7 days' > now())
    );
END;
$$;

REVOKE ALL    ON FUNCTION public.get_guest_link_info(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_guest_link_info(UUID) TO anon;
GRANT EXECUTE ON FUNCTION public.get_guest_link_info(UUID) TO authenticated;

COMMENT ON FUNCTION public.get_guest_link_info(UUID) IS
  'Returns display-safe metadata for a single active guest link (7-day window + first_accessed_at). '
  'Re-deployed 20260522 for Live RPC 404 recovery. '
  'SET row_security TO off (RLS helper pattern).';

DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_guest_link_info'
  ), 'FAIL: get_guest_link_info missing after 20260522 migration';
END;
$$;
