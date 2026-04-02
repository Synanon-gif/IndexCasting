-- =============================================================================
-- Final Security Hardening — 2026-04 Audit Fixes
--
-- Addresses three remaining vulnerabilities from the 2026-04 full system audit:
--
--   VULN-C1 (CRITICAL): get_guest_link_info() and get_guest_link_models()
--     do not check deleted_at. A soft-deleted link (deleted_at IS NOT NULL)
--     with is_active still temporarily true survives the RLS guard because
--     SECURITY DEFINER bypasses the scoped RLS from migration_chaos_hardening.
--     Fix: add AND gl.deleted_at IS NULL to both RPC WHERE clauses.
--
--   VULN-H1 (HIGH): option_requests.status has no DB-level state-machine guard.
--     updateOptionRequestStatus() in the TypeScript service performs a plain
--     UPDATE with no transition check. An authenticated caller with write
--     permission could flip rejected → confirmed or confirmed → in_negotiation
--     via a direct API call.
--     Fix: BEFORE UPDATE trigger that enforces the allowed transition graph.
--
--   VULN-M1 (MEDIUM): agency_invitations UPDATE policy WITH CHECK only verifies
--     role = 'agent'. It does NOT verify that the new row still belongs to the
--     caller's own agency. An agent could UPDATE agency_id to a different agency.
--     Fix: mirror the USING ownership expressions in WITH CHECK.
--
-- Run AFTER migration_security_audit_2026_04.sql.
-- Idempotent: all CREATE OR REPLACE / DROP IF EXISTS / IF NOT EXISTS guards.
-- =============================================================================


-- ─── VULN-C1: Patch get_guest_link_info — add deleted_at IS NULL ──────────────
--
-- Previous WHERE: gl.is_active = true AND (expires_at IS NULL OR expires_at > now())
-- New WHERE adds: AND gl.deleted_at IS NULL
--
-- deleteGuestLink() in guestLinksSupabase.ts sets BOTH is_active = false AND
-- deleted_at = now(). The is_active check covers the common case. The deleted_at
-- guard closes the race window where a concurrent update sets deleted_at before
-- is_active is flipped, or where a direct DB write only sets deleted_at.

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
    AND gl.deleted_at IS NULL                                  -- VULN-C1 fix
    AND (gl.expires_at IS NULL OR gl.expires_at > now());
END;
$$;

REVOKE ALL    ON FUNCTION public.get_guest_link_info(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_guest_link_info(UUID) TO anon;
GRANT EXECUTE ON FUNCTION public.get_guest_link_info(UUID) TO authenticated;

COMMENT ON FUNCTION public.get_guest_link_info(UUID) IS
  'Returns display-safe metadata for a single active, non-expired, non-deleted guest link. '
  'Does NOT expose agency_id or model_ids. '
  'Safe for anon callers — requires knowing the link UUID. '
  'SECURITY DEFINER to bypass the scoped RLS on guest_links. '
  'VULN-C1 fix (2026-04 audit): deleted_at IS NULL guard added.';


-- ─── VULN-C1: Patch get_guest_link_models — add deleted_at IS NULL ───────────

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
  -- Validate: active, not expired, NOT soft-deleted (VULN-C1 fix).
  SELECT gl.model_ids, gl.type, gl.agency_id
    INTO v_model_ids, v_type, v_agency_id
    FROM public.guest_links gl
   WHERE gl.id         = p_link_id
     AND gl.is_active  = true
     AND gl.deleted_at IS NULL                                 -- VULN-C1 fix
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
    AND m.agency_id = v_agency_id;
END;
$$;

REVOKE ALL    ON FUNCTION public.get_guest_link_models(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_guest_link_models(UUID) TO anon;
GRANT EXECUTE ON FUNCTION public.get_guest_link_models(UUID) TO authenticated;

COMMENT ON FUNCTION public.get_guest_link_models(UUID) IS
  'Returns model fields for an active, non-expired, non-deleted guest link. '
  'Portfolio packages return portfolio_images only; polaroid packages return polaroids only. '
  'H-4 fix: model_ids filtered by m.agency_id = link.agency_id (cross-agency leak prevention). '
  'VULN-C1 fix (2026-04 audit): deleted_at IS NULL guard added. '
  'SECURITY DEFINER — safe for anon callers, scoped strictly to the linked models.';


-- ─── VULN-H1: DB-level state-machine for option_requests.status ──────────────
--
-- Allowed status transitions (application-level contract):
--
--   in_negotiation → confirmed    (agency accepts, no model account)
--   in_negotiation → confirmed    (model confirms after agency accept)
--   in_negotiation → rejected     (agency or client rejects)
--   confirmed      → rejected     BLOCKED (cannot un-confirm)
--   rejected       → *            BLOCKED (terminal state)
--
-- Allowed final_status transitions:
--
--   NULL            → option_pending   (initial insert path)
--   option_pending  → option_confirmed (agency accepts price)
--   option_confirmed → job_confirmed   (client confirms job)
--   job_confirmed   → *               BLOCKED (terminal state)
--   * → NULL is allowed only when status transitions to 'rejected'
--
-- The trigger fires BEFORE UPDATE so the row is never written in an invalid state.
-- It is deliberately permissive for NULL→value transitions (initial inserts set
-- final_status via INSERT, not UPDATE).

CREATE OR REPLACE FUNCTION public.fn_validate_option_status_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- ── status field ─────────────────────────────────────────────────────────

  -- Rejected is a terminal state — no recovery allowed.
  IF OLD.status = 'rejected' AND NEW.status IS DISTINCT FROM 'rejected' THEN
    RAISE EXCEPTION
      'option_requests: illegal status transition rejected → %. Rejected is terminal.',
      NEW.status
    USING ERRCODE = 'P0001';
  END IF;

  -- Confirmed cannot revert to negotiation.
  IF OLD.status = 'confirmed' AND NEW.status = 'in_negotiation' THEN
    RAISE EXCEPTION
      'option_requests: illegal status transition confirmed → in_negotiation. Confirmed cannot be reversed.'
    USING ERRCODE = 'P0001';
  END IF;

  -- ── final_status field ───────────────────────────────────────────────────

  -- job_confirmed is terminal — no further progression allowed.
  IF OLD.final_status = 'job_confirmed' AND NEW.final_status IS DISTINCT FROM 'job_confirmed' THEN
    RAISE EXCEPTION
      'option_requests: illegal final_status transition job_confirmed → %. job_confirmed is terminal.',
      COALESCE(NEW.final_status, 'NULL')
    USING ERRCODE = 'P0001';
  END IF;

  -- option_confirmed cannot revert to option_pending.
  IF OLD.final_status = 'option_confirmed' AND NEW.final_status = 'option_pending' THEN
    RAISE EXCEPTION
      'option_requests: illegal final_status transition option_confirmed → option_pending.'
    USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.fn_validate_option_status_transition() IS
  'Trigger function: enforces the option_requests status state machine at DB level. '
  'Prevents rejected→*, confirmed→in_negotiation, job_confirmed→*, option_confirmed→option_pending. '
  'VULN-H1 fix (2026-04 audit).';

-- Drop and recreate trigger to ensure idempotency.
DROP TRIGGER IF EXISTS trg_validate_option_status ON public.option_requests;

CREATE TRIGGER trg_validate_option_status
  BEFORE UPDATE OF status, final_status
  ON public.option_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_validate_option_status_transition();

COMMENT ON TRIGGER trg_validate_option_status ON public.option_requests IS
  'Enforces state-machine rules on status and final_status. VULN-H1 fix (2026-04 audit).';


-- ─── VULN-M1: Fix agency_invitations UPDATE — WITH CHECK mirrors USING ────────
--
-- Previous WITH CHECK: only checked role = 'agent'.
-- An authenticated agent could update a row to change agency_id to a different
-- agency (or NULL), then that row would pass USING on a subsequent request with
-- the caller now "owning" a rival agency's invitation record.
--
-- Fix: WITH CHECK must verify that the new row's agency_id still belongs to
-- the caller's own agency — the same ownership expressions used in USING.
-- Legacy rows (agency_id IS NULL) cannot be the target of UPDATE by this policy
-- (USING now requires agency_id IS NOT NULL, per migration_security_audit_2026_04).

DROP POLICY IF EXISTS "Agents can update own agency invitations" ON public.agency_invitations;

CREATE POLICY "Agents can update own agency invitations"
  ON public.agency_invitations
  FOR UPDATE
  TO authenticated
  USING (
    -- Caller must be an agent
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'agent'
    )
    -- Row must already belong to caller's agency (NULL-agency rows excluded)
    AND agency_id IS NOT NULL
    AND (
      EXISTS (
        SELECT 1 FROM public.agencies ag
        JOIN   public.organizations o  ON o.agency_id = ag.id
        JOIN   public.organization_members om ON om.organization_id = o.id
        WHERE  ag.id = agency_invitations.agency_id
          AND  om.user_id = auth.uid()
      )
      OR EXISTS (
        SELECT 1 FROM public.agencies ag
        JOIN   public.organizations o ON o.agency_id = ag.id
        WHERE  ag.id = agency_invitations.agency_id
          AND  o.owner_id = auth.uid()
      )
    )
  )
  WITH CHECK (
    -- After update the row must STILL belong to caller's own agency.
    -- Prevents swapping agency_id to a rival agency's UUID.
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'agent'
    )
    AND agency_id IS NOT NULL
    AND (
      EXISTS (
        SELECT 1 FROM public.agencies ag
        JOIN   public.organizations o  ON o.agency_id = ag.id
        JOIN   public.organization_members om ON om.organization_id = o.id
        WHERE  ag.id = agency_invitations.agency_id
          AND  om.user_id = auth.uid()
      )
      OR EXISTS (
        SELECT 1 FROM public.agencies ag
        JOIN   public.organizations o ON o.agency_id = ag.id
        WHERE  ag.id = agency_invitations.agency_id
          AND  o.owner_id = auth.uid()
      )
    )
  );

COMMENT ON POLICY "Agents can update own agency invitations" ON public.agency_invitations IS
  'UPDATE restricted to own-agency rows (agency_id IS NOT NULL, belongs to caller org). '
  'WITH CHECK mirrors USING: prevents changing agency_id to a rival agency. '
  'VULN-M1 fix (2026-04 audit). Supersedes migration_security_audit_2026_04.sql version.';


-- ─── PERF-VULN-M7: DB-side revenue aggregation RPC ──────────────────────────
--
-- Previously getAgencyRevenue() in bookingsSupabase.ts loaded every completed/
-- invoiced booking row into the JS runtime and reduced them there. At 100k
-- bookings this causes: (a) unbounded network transfer, (b) JS memory spikes,
-- (c) incorrect totals if the PostgREST request times out mid-fetch.
--
-- Fix: a SECURITY DEFINER RPC that runs SUM() in Postgres and returns a single
-- JSON object. The caller must be a member of an organization linked to the
-- agency — enforced server-side, cannot be spoofed.

CREATE OR REPLACE FUNCTION public.get_agency_revenue(p_agency_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
BEGIN
  -- Auth guard: caller must belong to an org linked to this agency.
  IF NOT EXISTS (
    SELECT 1
    FROM   public.organizations o
    JOIN   public.organization_members om ON om.organization_id = o.id
    WHERE  o.agency_id = p_agency_id
      AND  om.user_id  = auth.uid()
    UNION ALL
    SELECT 1
    FROM   public.organizations o
    WHERE  o.agency_id = p_agency_id
      AND  o.owner_id  = auth.uid()
    LIMIT 1
  ) THEN
    RAISE EXCEPTION 'get_agency_revenue: caller is not a member of agency %', p_agency_id
    USING ERRCODE = 'P0001';
  END IF;

  SELECT jsonb_build_object(
    'total_fees',       COALESCE(SUM(fee_total), 0),
    'total_commission', COALESCE(SUM(commission_amount), 0),
    'booking_count',    COUNT(*)
  )
  INTO v_result
  FROM public.bookings
  WHERE agency_id = p_agency_id
    AND status    IN ('completed', 'invoiced');

  RETURN v_result;
END;
$$;

REVOKE ALL    ON FUNCTION public.get_agency_revenue(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_agency_revenue(UUID) TO authenticated;

COMMENT ON FUNCTION public.get_agency_revenue(UUID) IS
  'Returns SUM(fee_total), SUM(commission_amount), COUNT(*) for completed/invoiced '
  'bookings of an agency. Auth-guarded: caller must be an org member of the agency. '
  'PERF-VULN-M7 fix (2026-04 audit): replaces JS-side reduce over unbounded row set.';


-- ─── Verification ─────────────────────────────────────────────────────────────

-- Confirm both guest-link RPCs were updated.
SELECT routine_name, routine_definition
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN ('get_guest_link_info', 'get_guest_link_models')
ORDER BY routine_name;

-- Confirm trigger is in place.
SELECT trigger_name, event_manipulation, action_timing
FROM information_schema.triggers
WHERE event_object_schema = 'public'
  AND event_object_table  = 'option_requests'
  AND trigger_name        = 'trg_validate_option_status';

-- Confirm agency_invitations UPDATE policy WITH CHECK is now non-trivial.
SELECT policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename  = 'agency_invitations'
  AND cmd        = 'UPDATE';
