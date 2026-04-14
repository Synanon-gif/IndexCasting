-- =============================================================================
-- Polaroid Discovery Restriction — canonical migration
--
-- Polaroids must NEVER appear in normal discovery or direct model queries.
-- They are only accessible to clients inside packages (guest links) via the
-- get_guest_link_models SECURITY DEFINER RPC.
--
-- This updates the client SELECT policy on model_photos to add
-- photo_type = 'portfolio' guard (blocking polaroid and private types).
-- Also ensures anon SELECT follows the same restriction.
--
-- Previously in root-SQL only (migration_polaroids_discovery_restriction.sql).
-- =============================================================================

-- Client policy: portfolio only (no polaroids, no private)
DROP POLICY IF EXISTS "Clients see visible model photos" ON public.model_photos;
DROP POLICY IF EXISTS "Clients see visible portfolio photos only" ON public.model_photos;

CREATE POLICY "Clients see visible portfolio photos only"
  ON public.model_photos FOR SELECT
  TO authenticated
  USING (
    is_visible_to_clients = true
    AND photo_type = 'portfolio'
    AND public.has_platform_access()
    AND public.caller_is_client_org_member()
  );

-- Anon policy: portfolio only (guest links resolve via RPC, not direct queries)
DROP POLICY IF EXISTS "Anon sees visible model photos" ON public.model_photos;
DROP POLICY IF EXISTS "Anon sees visible portfolio photos only" ON public.model_photos;

CREATE POLICY "Anon sees visible portfolio photos only"
  ON public.model_photos FOR SELECT
  TO anon
  USING (
    is_visible_to_clients = true
    AND photo_type = 'portfolio'
  );
