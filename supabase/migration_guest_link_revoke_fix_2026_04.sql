-- =============================================================================
-- Guest Link Function Security Patch — 2026-04
--
-- Two gaps closed:
--
--   1. REVOKE ALL missing on get_guest_link_models
--      In migration_guest_link_rate_limit.sql the REVOKE ALL ... FROM PUBLIC
--      was written for get_guest_link_info but omitted for get_guest_link_models.
--      PostgreSQL grants EXECUTE to PUBLIC by default on newly created functions.
--      Without an explicit REVOKE, future roles could gain implicit access.
--      Fix: REVOKE ALL FROM PUBLIC, then re-grant to anon + authenticated only.
--
--   2. deleted_at IS NULL missing in get_guest_link_info (prelaunch version)
--      migration_prelaunch_security_fixes.sql defined get_guest_link_info without
--      the deleted_at IS NULL guard. migration_guest_link_rate_limit.sql fixed
--      this later, but idempotently patching here ensures the guard is in place
--      regardless of migration execution order.
--
-- Idempotent. Safe to re-run.
-- Depends on: migration_guest_link_rate_limit.sql (enforce_guest_link_rate_limit)
-- =============================================================================


-- ─── 1. Patch get_guest_link_info — ensure deleted_at IS NULL guard ──────────

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
  -- Rate-limit: 60 requests per minute per IP (GDPR: IP hashed before storage)
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
  WHERE gl.id         = p_link_id
    AND gl.is_active  = true
    AND gl.deleted_at IS NULL
    AND (gl.expires_at IS NULL OR gl.expires_at > now());
END;
$$;

REVOKE ALL    ON FUNCTION public.get_guest_link_info(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_guest_link_info(UUID) TO anon;
GRANT EXECUTE ON FUNCTION public.get_guest_link_info(UUID) TO authenticated;

COMMENT ON FUNCTION public.get_guest_link_info(UUID) IS
  'Returns display-safe metadata for a single active, non-expired, non-deleted guest link. '
  'Enforces 60 req/min per-IP rate limit. '
  'Does NOT expose agency_id or model_ids. Safe for anon callers. '
  'Patch 2026-04: deleted_at IS NULL guard confirmed present.';


-- ─── 2. Patch get_guest_link_models — add missing REVOKE ALL FROM PUBLIC ─────

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
  -- Rate-limit: 30 requests per minute per IP (heavier query — tighter budget)
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

-- Explicitly revoke PUBLIC default, then grant only to required roles.
REVOKE ALL    ON FUNCTION public.get_guest_link_models(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_guest_link_models(UUID) TO anon;
GRANT EXECUTE ON FUNCTION public.get_guest_link_models(UUID) TO authenticated;

COMMENT ON FUNCTION public.get_guest_link_models(UUID) IS
  'Returns model fields for an active guest link (portfolio or polaroid type). '
  'Enforces 30 req/min per-IP rate limit. '
  'H-4: m.agency_id = link.agency_id prevents cross-agency leakage. '
  'VULN-C1: deleted_at IS NULL guard. SECURITY DEFINER — safe for anon. '
  'Patch 2026-04: REVOKE ALL FROM PUBLIC added (was missing in rate-limit migration).';


-- ─── Verification ─────────────────────────────────────────────────────────────

SELECT routine_name
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN ('get_guest_link_info', 'get_guest_link_models')
ORDER BY routine_name;
