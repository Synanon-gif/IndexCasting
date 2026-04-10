-- =============================================================================
-- Fix 42702: column reference "id" is ambiguous in get_guest_link_models.
--
-- RETURNS TABLE (id uuid, ...) creates a PL/pgSQL output variable named `id`.
-- UPDATE ... WHERE id = p_link_id was ambiguous vs public.guest_links.id.
-- Qualify the UPDATE target columns (20260530 migration).
-- =============================================================================

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
  polaroids        TEXT[],
  effective_city   TEXT
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
  IF NOT public.enforce_guest_link_rate_limit(30) THEN
    RAISE EXCEPTION 'rate_limit_exceeded'
      USING HINT = 'Too many requests. Please wait before retrying.',
            ERRCODE = 'P0001';
  END IF;

  SELECT
    gl.model_ids,
    gl.type,
    gl.agency_id,
    (gl.first_accessed_at IS NOT NULL)
  INTO v_model_ids, v_type, v_agency_id, v_already_accessed
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

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF NOT v_already_accessed THEN
    UPDATE public.guest_links
    SET first_accessed_at = now()
    WHERE public.guest_links.id = p_link_id
      AND public.guest_links.first_accessed_at IS NULL;
  END IF;

  BEGIN
    INSERT INTO public.guest_link_access_log (link_id, event_type, created_at)
    VALUES (p_link_id, 'models_loaded', now());
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

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
    CASE WHEN v_type = 'polaroid'  THEN COALESCE(m.polaroids, '{}')        ELSE '{}' END,
    (
      SELECT ml.city
      FROM public.model_locations ml
      WHERE ml.model_id = m.id
        AND ml.city IS NOT NULL
        AND TRIM(ml.city) <> ''
      ORDER BY CASE ml.source
        WHEN 'live'    THEN 0
        WHEN 'current' THEN 1
        WHEN 'agency'  THEN 2
        ELSE 3
      END ASC
      LIMIT 1
    )
  FROM public.models m
  WHERE m.id        = ANY(v_model_ids)
    AND m.agency_id = v_agency_id;
END;
$$;

REVOKE ALL    ON FUNCTION public.get_guest_link_models(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_guest_link_models(UUID) TO anon;
GRANT EXECUTE ON FUNCTION public.get_guest_link_models(UUID) TO authenticated;

COMMENT ON FUNCTION public.get_guest_link_models(UUID) IS
  'Returns model fields for an active guest link. '
  'H-4: m.agency_id = link.agency_id prevents cross-agency leakage. '
  'SECURITY DEFINER, row_security=off, rate-limited. '
  'No can_access_platform — package access is link-scoped. '
  '20260531: fix ambiguous id in guest_links UPDATE (RETURNS TABLE vs column).';

DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_guest_link_models'
  ), 'FAIL: get_guest_link_models missing after 20260531 migration';
END $$;

NOTIFY pgrst, 'reload schema';
