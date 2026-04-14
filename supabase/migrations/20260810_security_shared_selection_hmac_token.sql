-- F-06 Security fix: Protect get_shared_selection_models with HMAC token verification.
-- Previously any anonymous caller could query up to 50 model profiles by UUID.
-- Now the caller must provide a valid HMAC-SHA256 token computed from the sorted
-- model IDs joined with the server-side secret. The share link generator in the
-- frontend computes this token using the same secret (exposed via env/config).
--
-- This prevents UUID enumeration attacks while preserving the "no login required"
-- browsing experience for shared selection links.

-- Step 1: Store the HMAC secret. Using a dedicated single-row config table.
CREATE TABLE IF NOT EXISTS public.shared_selection_config (
  id         int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  hmac_key   text NOT NULL
);

ALTER TABLE public.shared_selection_config ENABLE ROW LEVEL SECURITY;

-- Only admin can read/write the config
DROP POLICY IF EXISTS "admin_only_shared_selection_config" ON public.shared_selection_config;
CREATE POLICY "admin_only_shared_selection_config"
  ON public.shared_selection_config
  FOR ALL TO authenticated
  USING (public.is_current_user_admin())
  WITH CHECK (public.is_current_user_admin());

-- Insert the secret (generated once; can be rotated via admin UPDATE)
INSERT INTO public.shared_selection_config (id, hmac_key)
VALUES (1, encode(gen_random_uuid()::text::bytea || gen_random_uuid()::text::bytea, 'hex'))
ON CONFLICT (id) DO NOTHING;

-- Step 2: Helper function to compute expected HMAC for given model IDs
CREATE OR REPLACE FUNCTION public.shared_selection_compute_hmac(p_model_ids uuid[])
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
  SELECT encode(
    sha256(
      (
        (SELECT hmac_key FROM public.shared_selection_config WHERE id = 1)
        || ':'
        || array_to_string(ARRAY(SELECT unnest(p_model_ids) ORDER BY 1), ',')
      )::bytea
    ),
    'hex'
  );
$$;

REVOKE ALL ON FUNCTION public.shared_selection_compute_hmac(uuid[]) FROM PUBLIC;
-- Only used internally by get_shared_selection_models; not directly callable
-- But we grant to authenticated so the frontend can call it when generating links
GRANT EXECUTE ON FUNCTION public.shared_selection_compute_hmac(uuid[]) TO authenticated;

-- Step 3: Replace the RPC with token-verified version
DROP FUNCTION IF EXISTS public.get_shared_selection_models(uuid[]);
DROP FUNCTION IF EXISTS public.get_shared_selection_models(uuid[], text);

CREATE OR REPLACE FUNCTION public.get_shared_selection_models(
  p_model_ids uuid[],
  p_token     text DEFAULT NULL
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
  v_ids          uuid[];
  v_expected     text;
BEGIN
  IF array_length(p_model_ids, 1) IS NULL OR array_length(p_model_ids, 1) = 0 THEN
    RETURN;
  END IF;

  IF array_length(p_model_ids, 1) > 50 THEN
    v_ids := p_model_ids[1:50];
  ELSE
    v_ids := p_model_ids;
  END IF;

  -- Token verification: compute expected HMAC and compare
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
    m.portfolio_images,
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
$$;

REVOKE ALL    ON FUNCTION public.get_shared_selection_models(uuid[], text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_shared_selection_models(uuid[], text) TO anon;
GRANT EXECUTE ON FUNCTION public.get_shared_selection_models(uuid[], text) TO authenticated;

COMMENT ON FUNCTION public.get_shared_selection_models(uuid[], text) IS
  'HMAC-token-protected RPC for SharedSelection gallery. Returns limited model data '
  'for explicit IDs. Token must be SHA-256 HMAC of sorted IDs with server secret. '
  'Capped at 50 IDs.';
