-- =============================================================================
-- Fix: Territory is the only valid representation scope for client visibility.
--
-- Previous policy allowed `country_code IS NOT NULL` as an alternative to a
-- territory entry. This was inconsistent with the product rule that an agency
-- must explicitly assign at least one territory of representation before a
-- model appears to clients.
--
-- New rule: a model is readable by clients only when
--   (a) a visibility flag is true (is_visible_commercial OR is_visible_fashion)
--   (b) at least one model_agency_territories row exists for the model
--
-- The country_code field is kept as supplementary data (home country, location
-- lookup, completeness alert) but is no longer sufficient on its own to make a
-- model visible.
-- =============================================================================

-- Drop all known variants of the client-models SELECT policy to avoid conflicts.
DROP POLICY IF EXISTS "Clients can read represented visible models" ON public.models;
DROP POLICY IF EXISTS "clients_read_represented_visible_models"     ON public.models;
DROP POLICY IF EXISTS "Clients read visible models"                  ON public.models;
DROP POLICY IF EXISTS "clients_read_visible_models"                  ON public.models;

-- ---------------------------------------------------------------------------
-- New policy: territory required, visibility flags required
-- ---------------------------------------------------------------------------
CREATE POLICY "Clients can read represented visible models"
  ON public.models FOR SELECT
  TO authenticated
  USING (
    -- Caller must be a client (profile role, org member, or org owner)
    (
      EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid()
          AND p.role = 'client'
      )
      OR EXISTS (
        SELECT 1
        FROM public.organizations       o
        JOIN public.organization_members om ON om.organization_id = o.id
        WHERE o.type     = 'client'
          AND om.user_id = auth.uid()
      )
      OR EXISTS (
        SELECT 1
        FROM public.organizations o
        WHERE o.type     = 'client'
          AND o.owner_id = auth.uid()
      )
    )
    -- At least one visibility flag must be true (determines client TYPE, not just visibility)
    -- Defaults: is_visible_commercial = true for all newly created/imported models.
    AND (models.is_visible_commercial = true OR models.is_visible_fashion = true)
    -- Territory of representation is REQUIRED — country_code alone is NOT sufficient.
    AND EXISTS (
      SELECT 1
      FROM public.model_agency_territories mat
      WHERE mat.model_id = models.id
    )
  );

-- ---------------------------------------------------------------------------
-- Also drop & recreate the corresponding policy on models_with_territories
-- view (if it exists as a separate policy) for consistency.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Clients can read visible models with territories" ON public.models_with_territories;
DROP POLICY IF EXISTS "clients_read_visible_models_with_territories"     ON public.models_with_territories;

-- The view inherits RLS from the underlying models table, so no separate
-- policy is needed. Ensure RLS is enabled on the base table only.
ALTER TABLE public.models ENABLE ROW LEVEL SECURITY;
