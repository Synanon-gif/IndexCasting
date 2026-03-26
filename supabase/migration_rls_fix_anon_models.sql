-- =============================================================================
-- Security Fix: Anon access to models table
--
-- Problem: migration_phase3_rls_tighten.sql added an anon policy
--   CREATE POLICY "Anon can read models" ON public.models FOR SELECT TO anon USING (true);
--
-- This allows unauthenticated requests to read ALL model rows including body
-- measurements (height, bust, waist, hips), portfolio URLs, city, and other
-- personal data – a clear DSGVO violation.
--
-- The territory-scoped migrations (migration_models_rls_clients_via_territories.sql)
-- only drop the 'authenticated' broad policy, not the 'anon' one.
--
-- Fix: Drop the anon SELECT policy.
-- The apply-form (Bewerbungsseite) needs agency info (name/city), NOT full model
-- data. Serve apply-page model data via a SECURITY DEFINER RPC or a public view
-- exposing only agency name + city.
-- =============================================================================

DROP POLICY IF EXISTS "Anon can read models" ON public.models;

-- Also ensure the broad anon agency read (needed for the public apply page)
-- is constrained to read-only and limited fields where possible.
-- The existing "Anon can read agencies" policy (from migration_phase3) is
-- intentional for the apply form; no change needed there.
COMMENT ON TABLE public.models IS
  'Models managed by agencies. '
  'Access: agency org members (own agency), authenticated clients (territory-scoped), '
  'model owners (own row). '
  'Anon access: NONE (removed in migration_rls_fix_anon_models.sql).';
