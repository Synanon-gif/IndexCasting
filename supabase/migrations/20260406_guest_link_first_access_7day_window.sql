-- =============================================================================
-- Guest Link: first_accessed_at + 7-Day Access Window
--
-- PROBLEM:
--   Guest links have no "7 days from first open" guarantee.
--   Currently: expires_at is the only gate (NULL = no expiry, set date = hard cut-off).
--   Users who share a link and have the recipient open it expect 7 days of stable access.
--   The Agency can revoke at any time via is_active = false.
--
-- FIX:
--   1. Add first_accessed_at TIMESTAMPTZ column to guest_links.
--   2. get_guest_link_models() sets first_accessed_at = now() on first model load (server-side).
--   3. Both RPCs use a new validity predicate:
--        is_active = true
--        AND deleted_at IS NULL
--        AND (
--          -- Not yet opened: respect original expires_at (or no expiry if NULL)
--          (first_accessed_at IS NULL AND (expires_at IS NULL OR expires_at > now()))
--          OR
--          -- Already opened: 7-day window from first access, overrides original expires_at
--          (first_accessed_at IS NOT NULL AND first_accessed_at + INTERVAL '7 days' > now())
--        )
--
-- SECURITY:
--   - first_accessed_at is set ONLY server-side inside the SECURITY DEFINER RPC.
--   - Anon users cannot directly write to guest_links (RLS blocks it).
--   - Agency can always revoke by setting is_active = false or deleted_at = now().
--   - The 7-day window is per first_accessed_at, not per-session — one window per link.
--
-- RLS NOTE (admin-security.mdc Risiko 4):
--   Both functions are SECURITY DEFINER and read/write guest_links (RLS-protected).
--   SET row_security TO off added to all three clauses (reading, writing, validating).
--
-- Idempotent. Safe to re-run.
-- =============================================================================

-- ─── 1. Add first_accessed_at column (idempotent) ────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'guest_links'
      AND column_name  = 'first_accessed_at'
  ) THEN
    ALTER TABLE public.guest_links
      ADD COLUMN first_accessed_at TIMESTAMPTZ;

    COMMENT ON COLUMN public.guest_links.first_accessed_at IS
      'Timestamp of the first get_guest_link_models() call (first time a guest viewed the models). '
      'NULL = link was never opened. Once set, the 7-day access window applies, overriding expires_at. '
      'Set server-side only inside the SECURITY DEFINER get_guest_link_models() RPC.';
  END IF;
END $$;


-- ─── 2. Recreate get_guest_link_info with new validity predicate ──────────────

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
  WHERE gl.id        = p_link_id
    AND gl.is_active = true
    AND gl.deleted_at IS NULL
    AND (
      -- Never opened before: respect original expires_at (or allow if NULL)
      (gl.first_accessed_at IS NULL
        AND (gl.expires_at IS NULL OR gl.expires_at > now()))
      OR
      -- Already opened: 7-day window from first access — overrides original expires_at.
      -- Agency can still revoke at any time via is_active = false or deleted_at.
      (gl.first_accessed_at IS NOT NULL
        AND gl.first_accessed_at + INTERVAL '7 days' > now())
    );
END;
$$;

REVOKE ALL    ON FUNCTION public.get_guest_link_info(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_guest_link_info(UUID) TO anon;
GRANT EXECUTE ON FUNCTION public.get_guest_link_info(UUID) TO authenticated;

COMMENT ON FUNCTION public.get_guest_link_info(UUID) IS
  'Returns display-safe metadata for a single active, non-expired, non-deleted guest link. '
  'Enforces 60 req/min per-IP rate limit. '
  'Does NOT expose agency_id or model_ids. Safe for anon callers. '
  'Updated 20260406: first_accessed_at + 7-day access window logic. '
  'SET row_security TO off added (rls-security-patterns Risiko 4).';


-- ─── 3. Recreate get_guest_link_models with first_accessed_at tracking ────────

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
SET row_security TO off
AS $$
DECLARE
  v_model_ids       UUID[];
  v_type            TEXT;
  v_agency_id       UUID;
  v_already_accessed BOOLEAN;
BEGIN
  -- Rate-limit: 30 requests per minute per IP (heavier query — tighter budget)
  IF NOT public.enforce_guest_link_rate_limit(30) THEN
    RAISE EXCEPTION 'rate_limit_exceeded'
      USING HINT = 'Too many requests. Please wait before retrying.',
            ERRCODE = 'P0001';
  END IF;

  -- Validate the link: active, not deleted, and within the access window
  SELECT
    gl.model_ids,
    gl.type,
    gl.agency_id,
    (gl.first_accessed_at IS NOT NULL)   -- already opened before?
  INTO v_model_ids, v_type, v_agency_id, v_already_accessed
  FROM public.guest_links gl
  WHERE gl.id        = p_link_id
    AND gl.is_active = true
    AND gl.deleted_at IS NULL
    AND (
      -- Never opened before: respect original expires_at (or allow if NULL)
      (gl.first_accessed_at IS NULL
        AND (gl.expires_at IS NULL OR gl.expires_at > now()))
      OR
      -- Already opened: 7-day window from first access
      (gl.first_accessed_at IS NOT NULL
        AND gl.first_accessed_at + INTERVAL '7 days' > now())
    );

  IF NOT FOUND THEN
    -- Link is invalid, deactivated, expired, or deleted.
    RETURN;
  END IF;

  -- Set first_accessed_at on the very first model load (server-side only).
  -- This starts the 7-day access window. Subsequent calls do not update it.
  IF NOT v_already_accessed THEN
    UPDATE public.guest_links
    SET first_accessed_at = now()
    WHERE id = p_link_id
      AND first_accessed_at IS NULL; -- guard against concurrent first-access race
  END IF;

  -- Log the access event (audit trail)
  BEGIN
    INSERT INTO public.guest_link_access_log (link_id, event_type, created_at)
    VALUES (p_link_id, 'models_loaded', now());
  EXCEPTION WHEN OTHERS THEN
    -- Non-fatal: audit log failure must not block the guest from viewing models.
    NULL;
  END;

  -- Return model data scoped to this link's agency (H-4: cross-agency leak prevention)
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
  'Returns model fields for an active guest link (portfolio or polaroid type). '
  'Enforces 30 req/min per-IP rate limit. '
  'H-4: m.agency_id = link.agency_id prevents cross-agency leakage. '
  'VULN-C1: deleted_at IS NULL guard. SECURITY DEFINER — safe for anon. '
  'Updated 20260406: sets first_accessed_at on first call (starts 7-day window). '
  'SET row_security TO off added (rls-security-patterns Risiko 4).';


-- ─── Verification ─────────────────────────────────────────────────────────────

DO $$
BEGIN
  -- Column exists
  ASSERT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'guest_links'
      AND column_name  = 'first_accessed_at'
  ), 'FAIL: first_accessed_at column not found on guest_links';

  -- Both RPCs exist
  ASSERT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'get_guest_link_info'),
    'FAIL: get_guest_link_info not found';
  ASSERT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'get_guest_link_models'),
    'FAIL: get_guest_link_models not found';

  RAISE NOTICE 'PASS: 20260406_guest_link_first_access_7day_window — first_accessed_at + RPCs updated';
END $$;
