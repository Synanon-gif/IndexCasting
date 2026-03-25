-- =============================================================================
-- Client filter preset: per-user saved discovery filters
--
-- Adds a `client_filter_preset` JSONB column to `profiles`.
-- Each user can save their own filter state (country, category, measurements, …)
-- so it is available across devices and browser sessions.
--
-- RLS: users can only read/write their own row (profiles.id = auth.uid()).
-- =============================================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS client_filter_preset JSONB DEFAULT NULL;

COMMENT ON COLUMN public.profiles.client_filter_preset IS
  'Saved discovery filter state (JSON) for client-side model discovery. '
  'Schema: { size, countryCode, city, nearby, category, sportsWinter, sportsSummer, '
  'hairColor, hipsMin, hipsMax, waistMin, waistMax, chestMin, chestMax, legsInseamMin, legsInseamMax }';

-- ---------------------------------------------------------------------------
-- RPC: save_client_filter_preset — writes only the caller's own row
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.save_client_filter_preset(JSONB);

CREATE OR REPLACE FUNCTION public.save_client_filter_preset(p_preset JSONB)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  UPDATE public.profiles
  SET client_filter_preset = p_preset
  WHERE id = v_uid;

  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.save_client_filter_preset(JSONB) TO authenticated;

-- ---------------------------------------------------------------------------
-- RPC: load_client_filter_preset — reads the caller's own saved preset
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.load_client_filter_preset();

CREATE OR REPLACE FUNCTION public.load_client_filter_preset()
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT client_filter_preset
  FROM   public.profiles
  WHERE  id = auth.uid();
$$;

GRANT EXECUTE ON FUNCTION public.load_client_filter_preset() TO authenticated;
