-- =============================================================================
-- Agency API Keys — Secure Access via SECURITY DEFINER RPC
--
-- The columns agencies.mediaslide_api_key and agencies.netwalk_api_key were
-- added in migration_phase13_enhancements.sql but never had RLS protection.
--
-- Supabase RLS operates at row level, not column level. To prevent API keys
-- from being read by any authenticated user who can SELECT the agencies row,
-- we expose them only through a SECURITY DEFINER RPC that checks org membership.
--
-- RLS approach:
--   - Agency public profile (name, city, email, …) stays readable via the
--     existing broad SELECT policy on agencies.
--   - API keys are NOT included in the regular getAgencies / getAgencyById
--     queries (those SELECT statements never request these columns).
--   - The SECURITY DEFINER RPC get_agency_api_keys() is the only authorised
--     path that returns API key values — only for owners and bookers.
--   - UPDATE of API key columns is gated by the existing owner-only UPDATE
--     policy on agencies (migration_agency_settings_and_model_photos_rls.sql).
--     Bookers can read but NOT write keys.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. SECURITY DEFINER RPC: get_agency_api_keys
--    Returns API key fields only if the caller is an owner or booker of the
--    agency's organisation.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_agency_api_keys(p_agency_id uuid)
RETURNS TABLE (
  mediaslide_api_key   text,
  netwalk_api_key      text,
  mediaslide_connected boolean,
  netwalk_connected    boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Verify caller is owner or booker of this agency's org.
  IF NOT EXISTS (
    SELECT 1
    FROM public.organizations o
    JOIN public.organization_members om
      ON om.organization_id = o.id
    WHERE o.agency_id = p_agency_id
      AND om.user_id = auth.uid()
      AND om.role IN ('owner', 'booker')
  )
  AND NOT EXISTS (
    -- Fallback: bookers table (older sign-up path)
    SELECT 1
    FROM public.bookers b
    WHERE b.agency_id = p_agency_id
      AND b.user_id = auth.uid()
  ) THEN
    -- Return empty row set (no error, just no data — avoids leaking existence)
    RETURN;
  END IF;

  RETURN QUERY
    SELECT
      a.mediaslide_api_key,
      a.netwalk_api_key,
      COALESCE(a.mediaslide_connected, false),
      COALESCE(a.netwalk_connected, false)
    FROM public.agencies a
    WHERE a.id = p_agency_id;
END;
$$;

COMMENT ON FUNCTION public.get_agency_api_keys(uuid) IS
  'Returns Mediaslide and Netwalk API keys for the given agency. '
  'Only accessible to organisation owners and bookers of that agency. '
  'SECURITY DEFINER to bypass column-level read restrictions on agencies.';

-- ---------------------------------------------------------------------------
-- 2. Save API connection — separate UPDATE function for booker-proof isolation
--    Owner-only UPDATE via existing RLS policy; expose a safe wrapper RPC so
--    only the owner role can write keys while using the same code path.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.save_agency_api_connection(
  p_agency_id uuid,
  p_provider  text,   -- 'mediaslide' or 'netwalk'
  p_api_key   text    -- null to disconnect
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only agency owners may write API credentials.
  IF NOT EXISTS (
    SELECT 1
    FROM public.organizations o
    JOIN public.organization_members om
      ON om.organization_id = o.id
    WHERE o.agency_id = p_agency_id
      AND om.user_id = auth.uid()
      AND om.role = 'owner'
  ) THEN
    RAISE EXCEPTION 'Only agency owners can save API credentials.';
  END IF;

  IF p_provider = 'mediaslide' THEN
    UPDATE public.agencies
    SET
      mediaslide_api_key   = p_api_key,
      mediaslide_connected = (p_api_key IS NOT NULL AND p_api_key <> ''),
      updated_at           = now()
    WHERE id = p_agency_id;

  ELSIF p_provider = 'netwalk' THEN
    UPDATE public.agencies
    SET
      netwalk_api_key   = p_api_key,
      netwalk_connected = (p_api_key IS NOT NULL AND p_api_key <> ''),
      updated_at        = now()
    WHERE id = p_agency_id;

  ELSE
    RAISE EXCEPTION 'Unknown provider: %', p_provider;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.save_agency_api_connection(uuid, text, text) IS
  'Saves a Mediaslide or Netwalk API key for an agency. '
  'Only callable by the agency organisation owner. '
  'Pass NULL as p_api_key to disconnect the provider.';
