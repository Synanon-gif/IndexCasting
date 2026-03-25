-- =============================================================================
-- Full agency-member access for models + model_photos
--
-- Goal: every member of an agency organization (owner_id OR any
--       organization_members row with role 'owner'/'booker') can:
--         • SELECT  model rows and photos for their agency
--         • INSERT  new model rows and photos
--         • UPDATE  all model fields (measurements, name, visibility, etc.)
--         • DELETE  model photos
--
-- Root cause of previous gaps:
--   1) models SELECT/UPDATE/INSERT only checked organization_members.role
--      IN ('owner','booker') — agency owners who signed up without going
--      through the invite flow had no organization_members row and were blocked.
--   2) model_photos SELECT was recreated by later migrations without the
--      owner_id fallback, so it reverted to members-only.
--
-- Pattern adopted from migration_model_photos_agency_owner_rls.sql.
-- Run after all previous migrations.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Helper: reusable USING/WITH CHECK expression (inline, no function needed)
--
-- Agency access = caller is the org owner  OR  is an org member with
-- role 'owner' or 'booker' for the agency that manages the model.
-- ---------------------------------------------------------------------------

-- ═══════════════════════════════════════════════════════════════════════════
-- MODELS TABLE
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.models ENABLE ROW LEVEL SECURITY;

-- ─── SELECT ─────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Agencies can read own agency models"            ON public.models;
DROP POLICY IF EXISTS "Agency owner or member can read agency models"  ON public.models;

CREATE POLICY "Agency owner or member can read agency models"
  ON public.models FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.organizations o
      WHERE o.type      = 'agency'
        AND o.agency_id = models.agency_id
        AND (
          -- Agency org owner (may not have an organization_members row)
          o.owner_id = auth.uid()
          -- Any invited member (booker, owner role in org members)
          OR EXISTS (
            SELECT 1 FROM public.organization_members om
            WHERE om.organization_id = o.id
              AND om.user_id = auth.uid()
              AND om.role IN ('owner', 'booker')
          )
        )
    )
  );

-- ─── UPDATE ─────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "models_update_agency_org_members"             ON public.models;
DROP POLICY IF EXISTS "Agency owner or member can update model"      ON public.models;

CREATE POLICY "Agency owner or member can update model"
  ON public.models FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.organizations o
      WHERE o.type      = 'agency'
        AND o.agency_id = models.agency_id
        AND (
          o.owner_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.organization_members om
            WHERE om.organization_id = o.id
              AND om.user_id = auth.uid()
              AND om.role IN ('owner', 'booker')
          )
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.organizations o
      WHERE o.type      = 'agency'
        AND o.agency_id = models.agency_id
        AND (
          o.owner_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.organization_members om
            WHERE om.organization_id = o.id
              AND om.user_id = auth.uid()
              AND om.role IN ('owner', 'booker')
          )
        )
    )
  );

-- ─── INSERT ─────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "models_insert_agency_org_members"             ON public.models;
DROP POLICY IF EXISTS "Agency owner or member can insert model"      ON public.models;

CREATE POLICY "Agency owner or member can insert model"
  ON public.models FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.organizations o
      WHERE o.type      = 'agency'
        AND o.agency_id = models.agency_id
        AND (
          o.owner_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.organization_members om
            WHERE om.organization_id = o.id
              AND om.user_id = auth.uid()
              AND om.role IN ('owner', 'booker')
          )
        )
    )
  );

-- ═══════════════════════════════════════════════════════════════════════════
-- MODEL_PHOTOS TABLE  (consolidate all policies in one place)
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.model_photos ENABLE ROW LEVEL SECURITY;

-- ─── SELECT ─────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Agency members see own model photos"           ON public.model_photos;
DROP POLICY IF EXISTS "Agency owner or member see own model photos"   ON public.model_photos;
DROP POLICY IF EXISTS "model_photos_select"                           ON public.model_photos;
DROP POLICY IF EXISTS "Clients see visible model photos"              ON public.model_photos;

-- Agency side: owner or any org member sees all photos for their models.
CREATE POLICY "Agency owner or member see own model photos"
  ON public.model_photos FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.models m
      JOIN public.organizations o ON o.agency_id = m.agency_id
      WHERE m.id = model_photos.model_id
        AND o.type = 'agency'
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

-- Client/model/other authenticated users: see photos flagged visible.
CREATE POLICY "Clients see visible model photos"
  ON public.model_photos FOR SELECT
  TO authenticated
  USING (is_visible_to_clients = true);

-- Anon (guest links): see publicly visible photos.
DROP POLICY IF EXISTS "model_photos_select_anon"        ON public.model_photos;
DROP POLICY IF EXISTS "Anon can see visible model photos" ON public.model_photos;

CREATE POLICY "Anon can see visible model photos"
  ON public.model_photos FOR SELECT
  TO anon
  USING (is_visible_to_clients = true);

-- ─── INSERT ─────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "model_photos_insert_agency"                   ON public.model_photos;

CREATE POLICY "model_photos_insert_agency"
  ON public.model_photos FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.models m
      JOIN public.organizations o ON o.agency_id = m.agency_id
      WHERE m.id = model_photos.model_id
        AND o.type = 'agency'
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

-- ─── UPDATE ─────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "model_photos_update_agency"                   ON public.model_photos;

CREATE POLICY "model_photos_update_agency"
  ON public.model_photos FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.models m
      JOIN public.organizations o ON o.agency_id = m.agency_id
      WHERE m.id = model_photos.model_id
        AND o.type = 'agency'
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
        AND o.type = 'agency'
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

-- ─── DELETE ─────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "model_photos_delete_agency"                   ON public.model_photos;

CREATE POLICY "model_photos_delete_agency"
  ON public.model_photos FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.models m
      JOIN public.organizations o ON o.agency_id = m.agency_id
      WHERE m.id = model_photos.model_id
        AND o.type = 'agency'
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
