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

-- =============================================================================
-- Security Hardening 2026-04
--
-- Fixes 6 security findings from the Major Security Audit:
--   1. Rate-Limit-Bypass: enforce_guest_link_rate_limit – p_max_requests_per_minute entfernt
--   2. IDOR: check_calendar_conflict – Berechtigungsprüfung via Agentur-Mitgliedschaft
--   3. Search-Path-Injection: fn_validate_option_status_transition – SET search_path = public
--   4. Spalten-Escape: model_update_own_profile – REVOKE kritische Spalten
--   5. Audit-Integrität: activity_logs Admin-Policy auf FOR SELECT einschränken
--
-- Idempotent – safe to run multiple times.
-- =============================================================================


-- ============================================================
-- FIX 1: Rate-Limit-Bypass – enforce_guest_link_rate_limit
--
-- Problem: p_max_requests_per_minute war ein Caller-kontrollierbarer Parameter.
--   Ein anon-User konnte mit p_max_requests_per_minute=999999 den Schutz umgehen.
-- Fix: Parameter entfernt; Limit intern hartcodiert (10 req/min).
--   Interne RPCs (get_guest_link_info, models) rufen die Funktion ohne Parameter
--   auf – Signaturwechsel erfordert DROP der alten Signatur.
-- ============================================================

-- Alte Signatur mit Parameter entfernen (inkompatibel mit der neuen)
DROP FUNCTION IF EXISTS public.enforce_guest_link_rate_limit(INTEGER);

CREATE OR REPLACE FUNCTION public.enforce_guest_link_rate_limit()
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
  v_limit   CONSTANT INTEGER := 10;
BEGIN
  BEGIN
    v_raw_ip := current_setting('request.headers', true)::json->>'x-forwarded-for';
  EXCEPTION WHEN OTHERS THEN
    v_raw_ip := NULL;
  END;

  IF v_raw_ip IS NOT NULL THEN
    v_raw_ip := split_part(trim(v_raw_ip), ',', 1);
  END IF;

  -- Fail-CLOSED sentinel: unresolvable IPs share a tight shared budget.
  IF v_raw_ip IS NULL OR trim(v_raw_ip) = '' THEN
    v_raw_ip := '__no_ip__';
  END IF;

  v_ip_hash := encode(digest(v_raw_ip, 'sha256'), 'hex');
  v_window  := date_trunc('minute', now());

  DELETE FROM public.guest_link_rate_limit
  WHERE window_start < (v_window - INTERVAL '2 minutes');

  INSERT INTO public.guest_link_rate_limit (ip_hash, window_start, request_count)
  VALUES (v_ip_hash, v_window, 1)
  ON CONFLICT (ip_hash, window_start)
  DO UPDATE SET request_count = guest_link_rate_limit.request_count + 1
  RETURNING request_count INTO v_count;

  RETURN v_count <= v_limit;
END;
$$;

REVOKE ALL    ON FUNCTION public.enforce_guest_link_rate_limit() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enforce_guest_link_rate_limit() TO anon;
GRANT EXECUTE ON FUNCTION public.enforce_guest_link_rate_limit() TO authenticated;

COMMENT ON FUNCTION public.enforce_guest_link_rate_limit() IS
  'Per-IP rate-limit check for guest link RPCs. '
  'Limit: 10 req/min (hardcoded – not caller-controllable). '
  'Fail-CLOSED: unresolvable IPs fall into shared __no_ip__ sentinel bucket. '
  'Security fix 2026-04: removed caller-supplied p_max_requests_per_minute parameter.';


-- ============================================================
-- FIX 2: IDOR – check_calendar_conflict
--
-- Problem: SECURITY DEFINER-Funktion las calendar_entries für beliebige p_model_id
--   ohne zu prüfen ob auth.uid() Zugriff auf dieses Model hat.
--   Jeder authentifizierte User konnte Kalender-Konflikte + Titel fremder Models auslesen.
-- Fix: Zugriffsprüfung – auth.uid() muss Mitglied der Agentur des Models sein.
--   Clients dürfen Konflikte für Models prüfen, die ihnen über eine Option zugänglich sind.
-- ============================================================

CREATE OR REPLACE FUNCTION public.check_calendar_conflict(
  p_model_id uuid,
  p_date     date,
  p_start    time,
  p_end      time
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entries   jsonb;
  v_count     integer;
  v_agency_id uuid;
BEGIN
  -- Berechtigungsprüfung: auth.uid() muss entweder
  --   (a) Mitglied der Agentur des Models sein, ODER
  --   (b) eine aktive Option / Casting für dieses Model in ihrer Client-Org haben.
  SELECT m.agency_id INTO v_agency_id
  FROM public.models m
  WHERE m.id = p_model_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Model not found';
  END IF;

  IF NOT (
    -- (a) Agentur-Mitglied
    public.user_is_member_of_organization(v_agency_id)
    OR
    -- (b) Client mit laufender Option für dieses Model
    EXISTS (
      SELECT 1
      FROM public.option_requests orq
      JOIN public.organization_members om
        ON om.organization_id = orq.client_organization_id
       AND om.user_id = auth.uid()
      WHERE orq.model_id = p_model_id
        AND orq.status NOT IN ('rejected', 'cancelled')
    )
  ) THEN
    RAISE EXCEPTION 'Access denied: no permission to view this model''s calendar';
  END IF;

  SELECT
    COUNT(*),
    jsonb_agg(jsonb_build_object(
      'id',         ce.id,
      'entry_type', ce.entry_type,
      'start_time', ce.start_time,
      'end_time',   ce.end_time,
      'title',      ce.title
    ))
  INTO v_count, v_entries
  FROM public.calendar_entries ce
  WHERE ce.model_id   = p_model_id
    AND ce.date       = p_date
    AND ce.entry_type IN ('option', 'casting', 'job')
    AND (
      ce.start_time IS NULL OR ce.end_time IS NULL
      OR (
        ce.start_time < COALESCE(p_end,   '23:59:59'::time)
        AND ce.end_time > COALESCE(p_start, '00:00:00'::time)
      )
    );

  RETURN jsonb_build_object(
    'has_conflict',        v_count > 0,
    'conflicting_entries', COALESCE(v_entries, '[]'::jsonb)
  );
END;
$$;

ALTER FUNCTION public.check_calendar_conflict(uuid, date, time, time) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.check_calendar_conflict(uuid, date, time, time) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_calendar_conflict(uuid, date, time, time) TO authenticated;

COMMENT ON FUNCTION public.check_calendar_conflict(uuid, date, time, time) IS
  'Checks calendar conflicts for a model. '
  'Access control: caller must be agency member OR have an active option for the model. '
  'Security fix 2026-04: IDOR vulnerability patched (was missing authorization check).';


-- ============================================================
-- FIX 3: Search-Path-Injection – fn_validate_option_status_transition
--
-- Problem: Trigger-Funktion hatte weder SECURITY DEFINER noch SET search_path = public.
--   Lief mit dem Session-search_path → Search-Path-Injection möglich.
-- Fix: SET search_path = public + alle Tabellenreferenzen mit public.-Präfix.
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_validate_option_status_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Terminal states: rejected rows cannot be changed
  IF OLD.status = 'rejected' AND NEW.status <> OLD.status THEN
    RAISE EXCEPTION 'Cannot transition from terminal state rejected (option_request %)', OLD.id;
  END IF;

  -- confirmed → in_negotiation is not allowed (no un-confirming)
  IF OLD.status = 'confirmed' AND NEW.status = 'in_negotiation' THEN
    RAISE EXCEPTION 'Cannot revert confirmed booking to in_negotiation (option_request %)', OLD.id;
  END IF;

  -- confirmed → rejected is not allowed (bookings cannot be arbitrarily cancelled via status)
  IF OLD.status = 'confirmed' AND NEW.status = 'rejected' THEN
    RAISE EXCEPTION 'Cannot reject an already confirmed booking (option_request %)', OLD.id;
  END IF;

  -- final_status: job_confirmed is terminal
  IF OLD.final_status = 'job_confirmed' AND NEW.final_status <> OLD.final_status THEN
    RAISE EXCEPTION 'Cannot change final_status after job_confirmed (option_request %)', OLD.id;
  END IF;

  -- final_status: option_confirmed → option_pending is not allowed
  IF OLD.final_status = 'option_confirmed' AND NEW.final_status = 'option_pending' THEN
    RAISE EXCEPTION 'Cannot revert option_confirmed to option_pending (option_request %)', OLD.id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_option_status ON public.option_requests;
CREATE TRIGGER trg_validate_option_status
  BEFORE UPDATE ON public.option_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_validate_option_status_transition();

COMMENT ON FUNCTION public.fn_validate_option_status_transition() IS
  'Trigger guard for option_request status transitions. '
  'Security fix 2026-04: added SET search_path = public to prevent search_path injection.';


-- ============================================================
-- FIX 4: model_update_own_profile – kritische Spalten sperren
--
-- Problem: RLS-Policy erlaubte Models, alle schreibbaren Spalten zu setzen,
--   inkl. agency_id, mediaslide_sync_id, mediaslide_model_id, netwalk_model_id,
--   admin_notes, agency_relationship_status.
-- Fix: REVOKE UPDATE-Rechte auf diese Spalten für authenticated.
--   Models können weiterhin eigene Profil-Felder (location, bio, etc.) ändern.
-- ============================================================

-- Kritische Spalten, die Models nicht selbst ändern dürfen:
REVOKE UPDATE (agency_id)                  ON public.models FROM authenticated;
REVOKE UPDATE (mediaslide_sync_id)         ON public.models FROM authenticated;
REVOKE UPDATE (mediaslide_model_id)        ON public.models FROM authenticated;
REVOKE UPDATE (netwalk_model_id)           ON public.models FROM authenticated;
REVOKE UPDATE (admin_notes)               ON public.models FROM authenticated;
REVOKE UPDATE (agency_relationship_status) ON public.models FROM authenticated;

COMMENT ON TABLE public.models IS
  'Model profiles. '
  'Column-level security (2026-04): authenticated users cannot UPDATE agency_id, '
  'mediaslide_sync_id, mediaslide_model_id, netwalk_model_id, admin_notes, '
  'agency_relationship_status directly.';


-- ============================================================
-- FIX 5: Audit-Integrität – activity_logs Admin-Policy
--
-- Problem: "activity_logs_admin_full_access" war FOR ALL, Admins konnten
--   Audit-Logs manipulieren und löschen → Audit-Integrität gefährdet.
-- Fix: Admin-Policy auf FOR SELECT einschränken.
--   INSERT bleibt ausschließlich über die log_activity()-RPC möglich.
-- ============================================================

DROP POLICY IF EXISTS "activity_logs_admin_full_access" ON public.activity_logs;
CREATE POLICY "activity_logs_admin_select_only"
  ON public.activity_logs FOR SELECT
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = TRUE));

COMMENT ON POLICY "activity_logs_admin_select_only" ON public.activity_logs IS
  'Admins may read all activity logs (any org) for debugging. '
  'Security fix 2026-04: downgraded from FOR ALL to FOR SELECT to protect audit integrity.';
