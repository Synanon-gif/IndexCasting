-- 20261020_guest_links_mixed_package_type.sql
--
-- Introduce a third PackageType `'mixed'` for guest links so an agency can ship
-- portfolio AND polaroid media in a single package. Internal and external
-- viewers (ClientWebApp + GuestView) toggle between Portfolio / Polaroid on the
-- client side; backend just returns BOTH arrays populated when v_type = 'mixed'.
--
-- Backward compatible:
--   - existing 'portfolio' and 'polaroid' rows behave identically (mutual
--     exclusivity preserved for those types).
--   - clients/guests that don't know about 'mixed' simply see whichever of the
--     two arrays they were already reading (both are populated).
--
-- Idempotent. Single migration; not deployed via root supabase/*.sql.

-- 1) Replace the CHECK constraint to also allow 'mixed'.
ALTER TABLE public.guest_links
  DROP CONSTRAINT IF EXISTS guest_links_type_check;

ALTER TABLE public.guest_links
  ADD CONSTRAINT guest_links_type_check
  CHECK (type = ANY (ARRAY['portfolio'::text, 'polaroid'::text, 'mixed'::text]));

-- 2) Replace get_guest_link_models so 'mixed' returns both arrays populated.
--    Portfolio array is returned when v_type IN ('portfolio', 'mixed');
--    Polaroid array is returned when v_type IN ('polaroid',  'mixed').
--    Everything else is identical to the previous (20260714) definition:
--    rate-limit, first-access window, access-log insert, model_photos fallback
--    when mirror columns are empty, effective_city via model_locations priority.

CREATE OR REPLACE FUNCTION public.get_guest_link_models(p_link_id uuid)
RETURNS TABLE(
  id uuid,
  name text,
  height integer,
  bust integer,
  waist integer,
  hips integer,
  city text,
  hair_color text,
  eye_color text,
  sex text,
  portfolio_images text[],
  polaroids text[],
  effective_city text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $function$
DECLARE
  v_model_ids        UUID[];
  v_type             TEXT;
  v_agency_id        UUID;
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
    -- Portfolio: returned for 'portfolio' AND 'mixed'
    CASE
      WHEN v_type NOT IN ('portfolio', 'mixed') THEN '{}'::text[]
      WHEN m.portfolio_images IS NOT NULL
        AND cardinality(m.portfolio_images) > 0
        AND COALESCE(btrim(m.portfolio_images[1]), '') <> ''
      THEN m.portfolio_images
      ELSE COALESCE(
        (
          SELECT array_agg(mp.url ORDER BY mp.sort_order ASC NULLS LAST, mp.created_at ASC)
          FROM public.model_photos mp
          WHERE mp.model_id = m.id
            AND mp.photo_type = 'portfolio'
            AND mp.is_visible_to_clients = true
            AND COALESCE(mp.visible, true) = true
        ),
        ARRAY[]::text[]
      )
    END AS portfolio_images,
    -- Polaroid: returned for 'polaroid' AND 'mixed'
    CASE
      WHEN v_type NOT IN ('polaroid', 'mixed') THEN '{}'::text[]
      WHEN m.polaroids IS NOT NULL
        AND cardinality(m.polaroids) > 0
        AND COALESCE(btrim(m.polaroids[1]), '') <> ''
      THEN m.polaroids
      ELSE COALESCE(
        (
          SELECT array_agg(mp.url ORDER BY mp.sort_order ASC NULLS LAST, mp.created_at ASC)
          FROM public.model_photos mp
          WHERE mp.model_id = m.id
            AND mp.photo_type = 'polaroid'
            AND mp.is_visible_to_clients = true
            AND COALESCE(mp.visible, true) = true
        ),
        ARRAY[]::text[]
      )
    END AS polaroids,
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
    ) AS effective_city
  FROM public.models m
  WHERE m.id        = ANY(v_model_ids)
    AND m.agency_id = v_agency_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_guest_link_models(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_guest_link_models(uuid) TO anon, authenticated;
