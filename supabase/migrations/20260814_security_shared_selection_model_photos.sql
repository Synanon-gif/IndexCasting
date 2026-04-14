-- F-15 Security fix: get_shared_selection_models reads from model_photos (source of truth)
-- instead of models.portfolio_images (mirror column) which may contain stale or
-- too-broad paths not filtered by is_visible_to_clients.
--
-- Returns portfolio photo URLs as an array built from model_photos rows
-- where photo_type='portfolio' AND is_visible_to_clients=true, ordered by sort_order.

CREATE OR REPLACE FUNCTION public.get_shared_selection_models(
  p_model_ids uuid[],
  p_token     text DEFAULT NULL
)
RETURNS TABLE(
  id               uuid,
  name             text,
  height           integer,
  chest            integer,
  bust             integer,
  waist            integer,
  hips             integer,
  city             text,
  portfolio_images text[],
  effective_city   text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
SET row_security TO 'off'
AS $function$
DECLARE
  v_ids      uuid[];
  v_expected text;
BEGIN
  IF array_length(p_model_ids, 1) IS NULL OR array_length(p_model_ids, 1) = 0 THEN
    RETURN;
  END IF;

  IF array_length(p_model_ids, 1) > 50 THEN
    v_ids := p_model_ids[1:50];
  ELSE
    v_ids := p_model_ids;
  END IF;

  IF p_token IS NULL OR trim(p_token) = '' THEN
    RAISE EXCEPTION 'shared_selection_token_required'
      USING HINT = 'A valid token is required to access shared selection data';
  END IF;

  v_expected := public.shared_selection_compute_hmac(v_ids);

  IF p_token != v_expected THEN
    RAISE EXCEPTION 'shared_selection_token_invalid'
      USING HINT = 'The provided token does not match the expected value';
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
    COALESCE(
      (SELECT array_agg(mp.url ORDER BY mp.sort_order ASC NULLS LAST, mp.created_at ASC)
       FROM public.model_photos mp
       WHERE mp.model_id = m.id
         AND mp.photo_type = 'portfolio'
         AND mp.is_visible_to_clients = true),
      ARRAY[]::text[]
    ) AS portfolio_images,
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
    AND m.name IS NOT NULL
    AND trim(m.name) != ''
    AND (m.is_visible_commercial = true OR m.is_visible_fashion = true);
END;
$function$;
