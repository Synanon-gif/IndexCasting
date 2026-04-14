-- =============================================================================
-- Scalability K2+K3: option_requests duplicate SELECT policy + messages RLS
--
-- K3: Remove duplicate SELECT policy (option_requests_select_scoped is
--     identical to option_requests_select — PostgreSQL evaluates BOTH per row
--     candidate even though they OR to the same result).
--
-- K2: Replace option_request_visible_to_me(uuid) with a version that fetches
--     all 6 columns in a SINGLE subquery row instead of 6 separate scalar
--     subqueries. At 100 messages per thread this saves ~500 subqueries.
--
-- Idempotent. Safe to re-run.
-- =============================================================================

-- ── K3: Drop the duplicate SELECT policy ─────────────────────────────────────

DROP POLICY IF EXISTS "option_requests_select_scoped" ON public.option_requests;

-- ── K2: Optimized option_request_visible_to_me ───────────────────────────────
-- Single-row fetch instead of 6 scalar subqueries.

CREATE OR REPLACE FUNCTION public.option_request_visible_to_me(p_request_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
SET row_security TO 'off'
AS $$
  SELECT public.option_request_visible_from_columns(
    oq.model_id,
    oq.client_organization_id,
    oq.organization_id,
    oq.client_id,
    oq.agency_organization_id,
    oq.agency_id
  )
  FROM public.option_requests oq
  WHERE oq.id = p_request_id;
$$;

COMMENT ON FUNCTION public.option_request_visible_to_me(uuid) IS
  'RLS helper: id-based visibility via single row fetch (was 6 scalar subqueries). '
  'Delegates to option_request_visible_from_columns. 20260802 scalability fix.';

-- ── Verification ─────────────────────────────────────────────────────────────

DO $$
BEGIN
  -- K3: exactly one SELECT policy should remain
  ASSERT (
    SELECT count(*) FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'option_requests'
      AND cmd = 'SELECT'
  ) >= 1, 'FAIL: no SELECT policy on option_requests after K3 fix';

  -- K3: duplicate should be gone
  ASSERT NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'option_requests'
      AND policyname = 'option_requests_select_scoped'
  ), 'FAIL: option_requests_select_scoped still exists after K3 fix';
END;
$$;
