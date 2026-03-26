-- =============================================================================
-- Three Mandatory Fields — RLS enforcement
--
-- A model represented by an agency is shown to clients ONLY IF all three
-- mandatory fields are present:
--   1. name         — non-empty string
--   2. territory    — at least one row in model_agency_territories
--   3. photos       — at least one URL in models.portfolio_images
--                     (kept in sync with model_photos via syncPortfolioToModel)
--
-- Replaces migration_fix_client_rls_territory_required.sql which only checked
-- territory. This migration additionally enforces name and photo presence.
--
-- The portfolio_images array check (array_length > 0) is used instead of a
-- JOIN on model_photos to avoid an extra subquery per row. The array is
-- reliably kept in sync on every save and import via syncPortfolioToModel.
-- =============================================================================

-- Drop all known variants of the client-models SELECT policy.
DROP POLICY IF EXISTS "Clients can read represented visible models" ON public.models;
DROP POLICY IF EXISTS "clients_read_represented_visible_models"     ON public.models;
DROP POLICY IF EXISTS "Clients read visible models"                  ON public.models;
DROP POLICY IF EXISTS "clients_read_visible_models"                  ON public.models;

-- ---------------------------------------------------------------------------
-- New policy: name + territory + photos all required
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
    -- Visibility flags determine client TYPE (fashion vs commercial).
    -- Defaults: is_visible_commercial = true on every new/imported model.
    AND (models.is_visible_commercial = true OR models.is_visible_fashion = true)
    -- MANDATORY FIELD 1: full name must be set
    AND models.name IS NOT NULL
    AND trim(models.name) != ''
    -- MANDATORY FIELD 2: at least one territory of representation assigned
    AND EXISTS (
      SELECT 1
      FROM public.model_agency_territories mat
      WHERE mat.model_id = models.id
    )
    -- MANDATORY FIELD 3: at least one visible portfolio photo
    AND array_length(models.portfolio_images, 1) > 0
  );

-- Drop any stale view-level policies (view inherits base table RLS).
DROP POLICY IF EXISTS "Clients can read visible models with territories" ON public.models_with_territories;
DROP POLICY IF EXISTS "clients_read_visible_models_with_territories"     ON public.models_with_territories;

ALTER TABLE public.models ENABLE ROW LEVEL SECURITY;
