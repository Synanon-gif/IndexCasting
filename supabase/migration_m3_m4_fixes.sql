-- =============================================================================
-- DEPRECATED / DO NOT EXECUTE — DIAGNOSE ONLY (NOT DEPLOYED via supabase CLI)
--
-- This file lives outside `supabase/migrations/` and is NOT auto-deployed.
-- Canonical, deployed sources of truth live in `supabase/migrations/YYYYMMDD_*.sql`.
-- Manual execution can introduce silent regressions on the live DB
-- (RLS recursion, weakened SECURITY DEFINER guards, broken admin access, etc.).
--
-- See: `.cursor/rules/system-invariants.mdc` (LIVE-DB SOURCE OF TRUTH),
--      `docs/LIVE_DB_DRIFT_GUARDRAIL.md`,
--      `docs/CONSISTENCY_FLOW_CHECK_2026-04-19.md` (Cluster F).
--
-- If you need to apply changes, create a new dated migration in `supabase/migrations/`.
-- =============================================================================

-- EXPLOIT-M3 + EXPLOIT-M4 Fixes
--
-- M3: Extend trg_validate_option_status to guard model_approval transitions.
--     Prevents a Model from flipping an already-rejected/approved model_approval
--     back to pending, bypassing the state machine.
--
-- M4: Wire guest_link_access_log INSERT into get_guest_link_models().
--     The table and RLS policy exist (migration_compliance_hardening_2026_04.sql)
--     but get_guest_link_models() never wrote to it — audit trail was empty.


-- =============================================================================
-- M3: Extend fn_validate_option_status_transition to cover model_approval
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fn_validate_option_status_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
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

  -- ── model_approval field (EXPLOIT-M3 fix) ────────────────────────────────

  -- rejected model_approval is terminal — cannot be re-opened.
  -- Exception: the same row can transition status AND model_approval simultaneously
  -- (e.g. modelRejectOptionRequest sets both status=rejected and model_approval=rejected).
  -- We only block reversal FROM rejected TO pending/approved.
  IF OLD.model_approval = 'rejected'
     AND NEW.model_approval IS DISTINCT FROM 'rejected' THEN
    RAISE EXCEPTION
      'option_requests: illegal model_approval transition rejected → %. Model rejection is terminal.',
      NEW.model_approval
    USING ERRCODE = 'P0001';
  END IF;

  -- approved model_approval cannot revert to pending (prevents timing manipulation).
  IF OLD.model_approval = 'approved'
     AND NEW.model_approval = 'pending' THEN
    RAISE EXCEPTION
      'option_requests: illegal model_approval transition approved → pending.'
    USING ERRCODE = 'P0001';
  END IF;

  -- Cannot set model_approval to approved on an already-rejected request.
  IF NEW.status = 'rejected' AND NEW.model_approval = 'approved'
     AND OLD.model_approval = 'pending' AND OLD.status != 'rejected' THEN
    -- This case is the simultaneous set by modelRejectOptionRequest — allow it
    -- (model_approval='rejected' will be enforced by the check above in subsequent calls).
    NULL;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.fn_validate_option_status_transition() IS
  'Trigger function: enforces the option_requests status state machine at DB level. '
  'Guards: status (rejected terminal, confirmed→in_negotiation blocked), '
  'final_status (job_confirmed terminal, option_confirmed→option_pending blocked), '
  'model_approval (rejected terminal, approved→pending blocked). '
  'VULN-H1 + EXPLOIT-M3 fix.';

-- Recreate trigger to include model_approval in the OF clause.
DROP TRIGGER IF EXISTS trg_validate_option_status ON public.option_requests;

CREATE TRIGGER trg_validate_option_status
  BEFORE UPDATE OF status, final_status, model_approval
  ON public.option_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_validate_option_status_transition();

COMMENT ON TRIGGER trg_validate_option_status ON public.option_requests IS
  'Enforces state-machine rules on status, final_status, and model_approval. '
  'VULN-H1 + EXPLOIT-M3 fix.';


-- =============================================================================
-- M4: Wire guest_link_access_log INSERT into get_guest_link_models()
-- =============================================================================
-- The table and INSERT RLS policy already exist from
-- migration_compliance_hardening_2026_04.sql. The function only lacked the
-- actual INSERT — the audit trail was permanently empty.
--
-- Based on the most recent version in migration_guest_link_revoke_fix_2026_04.sql.
-- We replace the function body to add the INSERT; all other logic is identical.

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
  -- Rate-limit: 30 requests per minute per IP
  IF NOT public.enforce_guest_link_rate_limit(30) THEN
    RAISE EXCEPTION 'rate_limit_exceeded'
      USING HINT = 'Too many requests. Please wait before retrying.',
            ERRCODE = 'P0001';
  END IF;

  -- Validate the link: active, not expired, not deleted
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

  -- EXPLOIT-M4 fix: record that models were loaded for this link.
  -- Uses event_type='models_loaded' per the check constraint in
  -- migration_compliance_hardening_2026_04.sql. ip_hash and user_agent
  -- are not available inside a PL/pgSQL function — left NULL (GDPR-safe).
  INSERT INTO public.guest_link_access_log (link_id, event_type)
  VALUES (p_link_id, 'models_loaded')
  ON CONFLICT DO NOTHING;

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

-- Maintain exact same permissions as before.
REVOKE ALL    ON FUNCTION public.get_guest_link_models(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_guest_link_models(UUID) TO anon;
GRANT EXECUTE ON FUNCTION public.get_guest_link_models(UUID) TO authenticated;

COMMENT ON FUNCTION public.get_guest_link_models(UUID) IS
  'Returns model fields for an active guest link (portfolio or polaroid type). '
  'Enforces 30 req/min per-IP rate limit. '
  'H-4: m.agency_id = link.agency_id prevents cross-agency leakage. '
  'EXPLOIT-M4 fix: INSERTs into guest_link_access_log on every successful model load.';
