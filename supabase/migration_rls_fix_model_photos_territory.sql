-- =============================================================================
-- Security Fix: model_photos – add territory check to client SELECT policy
--
-- Problem: "Clients see visible model photos" (migration_model_photos_rls_tighten.sql)
--   checks only is_visible_to_clients = true. A client who knows a model_id
--   (e.g. from a public URL or a previous cache) can query model_photos
--   directly and access photos even for models they cannot discover through
--   the territory-scoped models RLS.
--
-- Fix: Add an EXISTS check on public.models that mirrors the territory check
--   used in the authenticated-client path of migration_models_rls_clients_via_territories.sql.
--   Agency members and the model's own account are already covered by the
--   separate "Agency members see own model photos" policy.
-- =============================================================================

DROP POLICY IF EXISTS "Clients see visible model photos" ON public.model_photos;

CREATE POLICY "Clients see visible model photos"
  ON public.model_photos
  FOR SELECT
  TO authenticated
  USING (
    is_visible_to_clients = true
    AND EXISTS (
      SELECT 1
      FROM public.models m
      WHERE m.id = model_photos.model_id
        AND (m.is_visible_commercial = true OR m.is_visible_fashion = true)
        AND (
          -- Model's own account can always see its photos
          m.user_id = auth.uid()

          -- Any authenticated user can see photos of represented models
          -- (at least one territory entry = the model is active in some country)
          OR EXISTS (
            SELECT 1
            FROM public.model_agency_territories mat
            WHERE mat.model_id = m.id
          )
        )
    )
  );
