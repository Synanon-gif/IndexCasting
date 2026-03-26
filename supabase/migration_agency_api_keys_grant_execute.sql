-- =============================================================================
-- Grant EXECUTE on Agency API Key RPCs
--
-- The functions get_agency_api_keys and save_agency_api_connection were created
-- in migration_agency_api_keys_rls.sql without explicit GRANT EXECUTE statements.
--
-- In Supabase, the `authenticated` role does not inherit EXECUTE on custom
-- functions by default. Without this grant, authenticated clients calling
-- supabase.rpc('get_agency_api_keys', ...) receive a permission-denied error.
--
-- Internal access control is handled inside each function (organization_members
-- role check / RAISE EXCEPTION for non-owners), so granting EXECUTE to
-- `authenticated` is safe.
-- =============================================================================

GRANT EXECUTE ON FUNCTION public.get_agency_api_keys(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_agency_api_connection(uuid, text, text) TO authenticated;
