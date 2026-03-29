-- =============================================================================
-- Package Type System
--
-- Replaces the include_polaroids boolean on guest_links with a strict
-- type column: 'portfolio' | 'polaroid'.
--
-- Portfolio Package → returns portfolio_images ONLY (polaroids = [])
-- Polaroid Package  → returns polaroids ONLY (portfolio_images = [])
--
-- Discovery NEVER shows polaroids — enforced at API + RLS level.
--
-- MIGRATION ORDER REQUIREMENT:
--   This migration MUST be applied AFTER migration_model_media_system.sql.
--   Reason: migration_model_media_system.sql adds the include_polaroids column
--   and the first version of the get_guest_link_models RPC. This migration
--   then drops include_polaroids and replaces the RPC with the type-based version.
--   Applying this migration without the predecessor will fail (column does not exist).
--
--   Recommended apply order:
--     1. migration_model_media_system.sql
--     2. migration_package_type_system.sql          ← this file
--     3. migration_polaroids_discovery_restriction.sql
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) Add type column to guest_links
-- ---------------------------------------------------------------------------
ALTER TABLE public.guest_links
  ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'portfolio'
  CHECK (type IN ('portfolio', 'polaroid'));

-- ---------------------------------------------------------------------------
-- 2) Migrate existing rows: include_polaroids = true → type = 'polaroid'
-- ---------------------------------------------------------------------------
UPDATE public.guest_links
SET type = CASE WHEN include_polaroids = true THEN 'polaroid' ELSE 'portfolio' END
WHERE include_polaroids IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3) Drop the now-obsolete include_polaroids column
-- ---------------------------------------------------------------------------
ALTER TABLE public.guest_links
  DROP COLUMN IF EXISTS include_polaroids;

-- ---------------------------------------------------------------------------
-- 4) Replace get_guest_link_models RPC
--    Portfolio packages → portfolio_images only, polaroids = {}
--    Polaroid packages  → polaroids only, portfolio_images = {}
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_guest_link_models(UUID);

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
BEGIN
  -- Validate the link: must be active and not expired.
  SELECT gl.model_ids, gl.type
    INTO v_model_ids, v_type
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
    -- Portfolio packages: return portfolio images only
    CASE WHEN v_type = 'portfolio' THEN COALESCE(m.portfolio_images, '{}') ELSE '{}' END,
    -- Polaroid packages: return polaroids only
    CASE WHEN v_type = 'polaroid'  THEN COALESCE(m.polaroids, '{}')        ELSE '{}' END
  FROM public.models m
  WHERE m.id = ANY(v_model_ids);
END;
$$;

-- Grant EXECUTE to both anon and authenticated roles.
GRANT EXECUTE ON FUNCTION public.get_guest_link_models(UUID) TO anon;
GRANT EXECUTE ON FUNCTION public.get_guest_link_models(UUID) TO authenticated;

COMMENT ON FUNCTION public.get_guest_link_models(UUID) IS
  'Returns model fields for an active guest link. '
  'Portfolio packages (type=''portfolio'') return portfolio_images only; polaroids = []. '
  'Polaroid packages (type=''polaroid'') return polaroids only; portfolio_images = []. '
  'Discovery and direct model queries NEVER expose polaroids. '
  'SECURITY DEFINER — safe for anon callers, scoped strictly to the linked models.';
