-- Migration: get_shared_selection_models
-- Purpose: Public RPC for SharedSelection links — returns a limited subset of model
-- data for explicitly provided model IDs. Analogous to get_guest_link_models but
-- scoped by caller-supplied UUIDs (the share URL is the access boundary).
--
-- Security model:
--   - SECURITY DEFINER + row_security=off bypasses RLS (models is authenticated-only)
--   - Only returns the fields needed for the read-only gallery view
--   - No sensitive/commercial fields exposed
--   - Caller provides explicit model IDs — no broader scan possible
--   - Capped at 50 IDs to prevent abuse
--   - GRANT TO anon + authenticated (external viewers are unauthenticated)

DROP FUNCTION IF EXISTS public.get_shared_selection_models(uuid[]);

CREATE OR REPLACE FUNCTION public.get_shared_selection_models(
  p_model_ids uuid[]
)
RETURNS TABLE (
  id             uuid,
  name           text,
  height         integer,
  chest          integer,
  bust           integer,
  waist          integer,
  hips           integer,
  city           text,
  portfolio_images text[],
  effective_city text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_ids uuid[];
BEGIN
  -- Cap at 50 IDs to prevent abuse / excessive load
  IF array_length(p_model_ids, 1) IS NULL OR array_length(p_model_ids, 1) = 0 THEN
    RETURN;
  END IF;

  IF array_length(p_model_ids, 1) > 50 THEN
    v_ids := p_model_ids[1:50];
  ELSE
    v_ids := p_model_ids;
  END IF;

  RETURN QUERY
  SELECT
    m.id,
    m.name,
    m.height,
    m.chest,
    m.bust,
    m.waist,
    m.hips,
    m.city,
    m.portfolio_images,
    -- Canonical city: model_locations (live>current>agency) fallback to models.city
    (
      SELECT ml.city
      FROM public.model_locations ml
      WHERE ml.model_id = m.id
      ORDER BY CASE ml.source
        WHEN 'live' THEN 0
        WHEN 'current' THEN 1
        WHEN 'agency' THEN 2
        ELSE 3
      END
      LIMIT 1
    ) AS effective_city
  FROM public.models m
  WHERE m.id = ANY(v_ids)
    -- Only return models that have basic visibility requirements met
    AND m.name IS NOT NULL
    AND trim(m.name) != ''
    AND (m.is_visible_commercial = true OR m.is_visible_fashion = true);
END;
$$;

REVOKE ALL    ON FUNCTION public.get_shared_selection_models(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_shared_selection_models(uuid[]) TO anon;
GRANT EXECUTE ON FUNCTION public.get_shared_selection_models(uuid[]) TO authenticated;

COMMENT ON FUNCTION public.get_shared_selection_models(uuid[]) IS
  'Public RPC for SharedSelection gallery — returns limited model data for explicit IDs. '
  'No auth required. Scoped by caller-supplied UUIDs; capped at 50.';
