-- =============================================================================
-- Fix: model_photos RLS – include organization owner in agency access check.
--
-- Root cause: the previous "Agency members see own model photos" policy only
-- checked organization_members (invited bookers). The agency OWNER is stored
-- in organizations.owner_id and is NOT automatically added to
-- organization_members, so they could not read/write their own models' photos.
-- =============================================================================

-- ─── SELECT ──────────────────────────────────────────────────────────────────

-- Drop the overly-narrow agency SELECT policy.
DROP POLICY IF EXISTS "Agency members see own model photos" ON public.model_photos;
DROP POLICY IF EXISTS "Agency owner or member see own model photos" ON public.model_photos;

-- Recreate: both org owner AND org members can read all photos for their models.
CREATE POLICY "Agency owner or member see own model photos"
  ON public.model_photos
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.models m
      JOIN public.organizations o ON o.agency_id = m.agency_id
      WHERE m.id = model_photos.model_id
        AND (
          -- Agency org owner
          o.owner_id = auth.uid()
          -- Any org member (booker, etc.)
          OR EXISTS (
            SELECT 1 FROM public.organization_members om
            WHERE om.organization_id = o.id
              AND om.user_id = auth.uid()
          )
        )
    )
  );

-- ─── INSERT ──────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "model_photos_insert_agency" ON public.model_photos;

CREATE POLICY "model_photos_insert_agency"
  ON public.model_photos
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.models m
      JOIN public.organizations o ON o.agency_id = m.agency_id
      WHERE m.id = model_photos.model_id
        AND (
          o.owner_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.organization_members om
            WHERE om.organization_id = o.id
              AND om.user_id = auth.uid()
          )
        )
    )
  );

-- ─── UPDATE ──────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "model_photos_update_agency" ON public.model_photos;

CREATE POLICY "model_photos_update_agency"
  ON public.model_photos
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.models m
      JOIN public.organizations o ON o.agency_id = m.agency_id
      WHERE m.id = model_photos.model_id
        AND (
          o.owner_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.organization_members om
            WHERE om.organization_id = o.id
              AND om.user_id = auth.uid()
          )
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.models m
      JOIN public.organizations o ON o.agency_id = m.agency_id
      WHERE m.id = model_photos.model_id
        AND (
          o.owner_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.organization_members om
            WHERE om.organization_id = o.id
              AND om.user_id = auth.uid()
          )
        )
    )
  );

-- ─── DELETE ──────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "model_photos_delete_agency" ON public.model_photos;

CREATE POLICY "model_photos_delete_agency"
  ON public.model_photos
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.models m
      JOIN public.organizations o ON o.agency_id = m.agency_id
      WHERE m.id = model_photos.model_id
        AND (
          o.owner_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.organization_members om
            WHERE om.organization_id = o.id
              AND om.user_id = auth.uid()
          )
        )
    )
  );
