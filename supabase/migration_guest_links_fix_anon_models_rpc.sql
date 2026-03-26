-- =============================================================================
-- Guest Links Fix: Anon model access via SECURITY DEFINER RPC
--
-- Problem: migration_rls_fix_anon_models.sql dropped "Anon can read models",
--   but GuestView.tsx calls getModelByIdFromSupabase() as an unauthenticated
--   (anon) user — resulting in empty model lists on all guest link pages.
--
-- Fix: Provide a SECURITY DEFINER function that returns only the models
--   referenced in a specific active, non-expired guest link. Anon users never
--   get a broad SELECT on models; they only see what the agency explicitly
--   packaged into the link.
--
-- Columns returned: the subset needed by GuestView (no sensitive internal
--   fields like agency_id, supabase_user_id, internal notes, etc.).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_guest_link_models(p_link_id UUID)
RETURNS TABLE (
  id             UUID,
  name           TEXT,
  height         INTEGER,
  bust           INTEGER,
  waist          INTEGER,
  hips           INTEGER,
  city           TEXT,
  hair_color     TEXT,
  eye_color      TEXT,
  sex            TEXT,
  portfolio_images TEXT[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_model_ids UUID[];
BEGIN
  -- Validate the link exists, is active, and not expired.
  -- Returns nothing if the link is invalid — same guard as getGuestLink().
  SELECT gl.model_ids
    INTO v_model_ids
    FROM public.guest_links gl
   WHERE gl.id        = p_link_id
     AND gl.is_active = true
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
    m.portfolio_images
  FROM public.models m
  WHERE m.id = ANY(v_model_ids);
END;
$$;

-- Grant EXECUTE to both anon and authenticated roles.
-- The function itself enforces the guest_link guard — no further RLS needed.
GRANT EXECUTE ON FUNCTION public.get_guest_link_models(UUID) TO anon;
GRANT EXECUTE ON FUNCTION public.get_guest_link_models(UUID) TO authenticated;

COMMENT ON FUNCTION public.get_guest_link_models(UUID) IS
  'Returns the subset of model fields needed by GuestView for an active, '
  'non-expired guest link. Safe for anon callers — access is scoped strictly '
  'to the models referenced in the specified link. SECURITY DEFINER to bypass '
  'RLS on models (anon SELECT was removed in migration_rls_fix_anon_models.sql).';
