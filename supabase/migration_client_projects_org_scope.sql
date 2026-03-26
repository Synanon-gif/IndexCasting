-- =============================================================================
-- MED-1: client_projects – Org-weiter Zugriff für alle Org-Mitglieder
--
-- Problem: client_projects war nur per owner_id gescopet. Org-Mitglieder
--   (Employees) konnten die Projekte des Org-Owners nicht sehen oder bearbeiten,
--   was das Multi-Tenant-Versprechen brach.
--
-- Fix:
--   1. organization_id Spalte hinzufügen (nullable für Legacy-Rows).
--   2. Legacy-Rows: owner_id bleibt als Fallback für alte Zeilen ohne org.
--   3. Neue RLS-Policy: Org-Mitglieder dürfen alle Projekte ihrer Org sehen
--      und bearbeiten.
--   4. Backfill: vorhandene Projekte über organization_members → organization_id
--      befüllen.
-- =============================================================================

-- 1. Spalte hinzufügen
ALTER TABLE public.client_projects
  ADD COLUMN IF NOT EXISTS organization_id UUID
    REFERENCES public.organizations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_client_projects_org
  ON public.client_projects (organization_id)
  WHERE organization_id IS NOT NULL;

-- 2. Backfill: organization_id für bestehende Projekte setzen
--    Voraussetzung: organizations + organization_members müssen bereits existieren.
UPDATE public.client_projects cp
SET organization_id = (
  SELECT om.organization_id
  FROM public.organization_members om
  JOIN public.organizations o ON o.id = om.organization_id
  WHERE om.user_id = cp.owner_id
    AND o.type     = 'client'
  LIMIT 1
)
WHERE cp.organization_id IS NULL;

-- 3. RLS ersetzen
DROP POLICY IF EXISTS "Users can CRUD own projects"        ON public.client_projects;
DROP POLICY IF EXISTS client_projects_org_member           ON public.client_projects;

CREATE POLICY client_projects_org_member
  ON public.client_projects FOR ALL
  TO authenticated
  USING (
    -- Modern: any member of the linked client org
    (
      organization_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.organization_members om
        WHERE om.organization_id = client_projects.organization_id
          AND om.user_id = auth.uid()
      )
    )
    -- Legacy: personal project without org tag (backward compat)
    OR (
      organization_id IS NULL
      AND owner_id = auth.uid()
    )
    -- Direct owner always has access
    OR owner_id = auth.uid()
  )
  WITH CHECK (
    (
      organization_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.organization_members om
        WHERE om.organization_id = client_projects.organization_id
          AND om.user_id = auth.uid()
      )
    )
    OR (organization_id IS NULL AND owner_id = auth.uid())
    OR owner_id = auth.uid()
  );

-- 4. client_project_models: policy über projects (JOIN)
DROP POLICY IF EXISTS "Users can CRUD project_models for own projects"  ON public.client_project_models;
DROP POLICY IF EXISTS client_project_models_org_member                  ON public.client_project_models;

CREATE POLICY client_project_models_org_member
  ON public.client_project_models FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.client_projects cp
      WHERE cp.id = project_id
        AND (
          (
            cp.organization_id IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM public.organization_members om
              WHERE om.organization_id = cp.organization_id
                AND om.user_id = auth.uid()
            )
          )
          OR (cp.organization_id IS NULL AND cp.owner_id = auth.uid())
          OR cp.owner_id = auth.uid()
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.client_projects cp
      WHERE cp.id = project_id
        AND (
          (
            cp.organization_id IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM public.organization_members om
              WHERE om.organization_id = cp.organization_id
                AND om.user_id = auth.uid()
            )
          )
          OR (cp.organization_id IS NULL AND cp.owner_id = auth.uid())
          OR cp.owner_id = auth.uid()
        )
    )
  );

COMMENT ON COLUMN public.client_projects.organization_id IS
  'Client org this project belongs to. All org members (owner + employees) have full access. '
  'NULL = legacy personal project (owner_id fallback).';
