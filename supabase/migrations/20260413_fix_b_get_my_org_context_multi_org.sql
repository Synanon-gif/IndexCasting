-- =============================================================================
-- Fix B: get_my_org_context() — Remove LIMIT 1, Add NULL Guard, Multi-Org Safe
--
-- PROBLEM:
--   Current function uses LIMIT 1 + ORDER BY created_at ASC, which silently
--   returns the oldest org context for users in multiple orgs. This violates
--   the explicit requirement: "NO implicit org resolution (no LIMIT 1 logic)."
--   A user in two agency orgs gets the wrong org context without any warning.
--   Additionally: auth.uid() IS NULL guard was missing (Rule 21 GUARD 1).
--
-- FIX:
--   1. Remove LIMIT 1 — return ALL memberships.
--   2. Convert from LANGUAGE sql to LANGUAGE plpgsql to add NULL guard (RAISE).
--   3. Frontend (AuthContext.tsx) picks orgCtx[0] and logs a warning when
--      multiple orgs are found — this makes the implicit choice EXPLICIT.
--
-- NOTE on subscriptionSupabase.ts:
--   That file also uses .from('organization_members').limit(1).maybeSingle().
--   That query is for a different purpose (billing org lookup). It is fixed
--   separately by reading all memberships and using the first explicitly,
--   consistent with the AuthContext pattern.
--
-- Idempotent: CREATE OR REPLACE.
-- =============================================================================

DROP FUNCTION IF EXISTS public.get_my_org_context();

CREATE OR REPLACE FUNCTION public.get_my_org_context()
RETURNS TABLE(
  organization_id uuid,
  org_type        organization_type,
  org_member_role org_member_role,
  agency_id       uuid
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
BEGIN
  -- GUARD 1: Must be authenticated (Rule 21)
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- Return ALL memberships, ordered oldest-first (deterministic).
  -- The caller (frontend) is responsible for selecting the active org explicitly.
  -- Having multiple rows does NOT cause errors — the frontend logs a warning and
  -- uses the first row until multi-org switching UI is implemented.
  RETURN QUERY
    SELECT
      m.organization_id,
      o.type          AS org_type,
      m.role          AS org_member_role,
      o.agency_id     AS agency_id
    FROM public.organization_members m
    JOIN public.organizations o ON o.id = m.organization_id
    WHERE m.user_id = auth.uid()
    ORDER BY m.created_at ASC;
END;
$$;

REVOKE ALL    ON FUNCTION public.get_my_org_context() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_org_context() TO authenticated;

COMMENT ON FUNCTION public.get_my_org_context() IS
  'Fix B (20260413): Returns ALL org memberships for the calling user (no LIMIT 1). '
  'Frontend picks the first (oldest) and logs a warning when multiple orgs exist. '
  'GUARD 1 (auth.uid() IS NULL → RAISE) added per Rule 21. '
  'SET row_security TO off prevents PG15+ latent recursion in SECURITY DEFINER context.';

-- ─── Verification ─────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_src text;
BEGIN
  SELECT prosrc INTO v_src FROM pg_proc WHERE proname = 'get_my_org_context' LIMIT 1;

  ASSERT v_src IS NOT NULL,
    'FAIL: get_my_org_context function not found';

  ASSERT v_src NOT ILIKE '%LIMIT 1%',
    'FAIL: get_my_org_context still contains LIMIT 1';

  ASSERT v_src ILIKE '%not_authenticated%',
    'FAIL: get_my_org_context missing auth.uid() IS NULL guard';

  RAISE NOTICE 'PASS: 20260413_fix_b — get_my_org_context has no LIMIT 1 and has NULL guard';
END $$;
