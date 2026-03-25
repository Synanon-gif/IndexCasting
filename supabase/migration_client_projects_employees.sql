-- =============================================================================
-- Client Projects: Org-Member Access für Employees
--
-- Problem: client_projects und client_project_models haben nur owner_id-basierte
--   Policies. Client Employees (organization_members mit role='employee') können
--   keine Projekte anderer Org-Mitglieder lesen oder bearbeiten.
--
-- Lösung: Neue additive Policies, die Org-Mitglieder (owner + employee)
--   in derselben client-Org zugreifen lassen.
--   Die ursprünglichen owner_id-Policies (schema.sql) bleiben erhalten (OR-Logik).
-- =============================================================================

-- ─── client_projects: SELECT für Org-Mitglieder ──────────────────────────────
DROP POLICY IF EXISTS "Client org members can read projects" ON public.client_projects;
CREATE POLICY "Client org members can read projects"
  ON public.client_projects FOR SELECT
  TO authenticated
  USING (
    -- Pfad A: eigene Projekte (wie bisher)
    owner_id = auth.uid()
    -- Pfad B: selbe Client-Org (Employee sieht alle Org-Projekte)
    OR EXISTS (
      SELECT 1
      FROM public.organization_members om_viewer  -- der anfragende User
      JOIN public.organization_members om_owner   -- der Projekt-Ersteller
        ON om_owner.organization_id = om_viewer.organization_id
      JOIN public.organizations o
        ON o.id = om_viewer.organization_id
      WHERE om_viewer.user_id = auth.uid()
        AND om_owner.user_id  = client_projects.owner_id
        AND o.type            = 'client'
    )
  );

-- ─── client_projects: INSERT (nur eigene Projekte) ───────────────────────────
DROP POLICY IF EXISTS "Client org members can insert projects" ON public.client_projects;
CREATE POLICY "Client org members can insert projects"
  ON public.client_projects FOR INSERT
  TO authenticated
  WITH CHECK (owner_id = auth.uid());

-- ─── client_projects: UPDATE für Org-Mitglieder ──────────────────────────────
DROP POLICY IF EXISTS "Client org members can update projects" ON public.client_projects;
CREATE POLICY "Client org members can update projects"
  ON public.client_projects FOR UPDATE
  TO authenticated
  USING (
    owner_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.organization_members om_viewer
      JOIN public.organization_members om_owner
        ON om_owner.organization_id = om_viewer.organization_id
      JOIN public.organizations o
        ON o.id = om_viewer.organization_id
      WHERE om_viewer.user_id = auth.uid()
        AND om_owner.user_id  = client_projects.owner_id
        AND o.type            = 'client'
    )
  )
  WITH CHECK (
    owner_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.organization_members om_viewer
      JOIN public.organization_members om_owner
        ON om_owner.organization_id = om_viewer.organization_id
      JOIN public.organizations o
        ON o.id = om_viewer.organization_id
      WHERE om_viewer.user_id = auth.uid()
        AND om_owner.user_id  = client_projects.owner_id
        AND o.type            = 'client'
    )
  );

-- ─── client_projects: DELETE (nur Owner darf löschen) ────────────────────────
DROP POLICY IF EXISTS "Client org members can delete projects" ON public.client_projects;
CREATE POLICY "Client org members can delete projects"
  ON public.client_projects FOR DELETE
  TO authenticated
  USING (owner_id = auth.uid());

-- Alte Catch-all-Policy ersetzen (war FOR ALL, jetzt durch obige getrennte Policies abgelöst)
DROP POLICY IF EXISTS "Users can CRUD own projects" ON public.client_projects;


-- =============================================================================
-- client_project_models: Org-Member Access
-- =============================================================================

DROP POLICY IF EXISTS "Client org members can manage project models" ON public.client_project_models;
CREATE POLICY "Client org members can manage project models"
  ON public.client_project_models FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.client_projects cp
      WHERE cp.id = client_project_models.project_id
        AND (
          -- Pfad A: eigenes Projekt
          cp.owner_id = auth.uid()
          -- Pfad B: gleiche Client-Org
          OR EXISTS (
            SELECT 1
            FROM public.organization_members om_viewer
            JOIN public.organization_members om_owner
              ON om_owner.organization_id = om_viewer.organization_id
            JOIN public.organizations o
              ON o.id = om_viewer.organization_id
            WHERE om_viewer.user_id = auth.uid()
              AND om_owner.user_id  = cp.owner_id
              AND o.type            = 'client'
          )
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.client_projects cp
      WHERE cp.id = client_project_models.project_id
        AND (
          cp.owner_id = auth.uid()
          OR EXISTS (
            SELECT 1
            FROM public.organization_members om_viewer
            JOIN public.organization_members om_owner
              ON om_owner.organization_id = om_viewer.organization_id
            JOIN public.organizations o
              ON o.id = om_viewer.organization_id
            WHERE om_viewer.user_id = auth.uid()
              AND om_owner.user_id  = cp.owner_id
              AND o.type            = 'client'
          )
        )
    )
  );

-- Alte Catch-all-Policy ersetzen
DROP POLICY IF EXISTS "Users can CRUD project_models for own projects" ON public.client_project_models;
