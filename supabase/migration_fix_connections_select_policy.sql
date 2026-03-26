-- =============================================================================
-- MED-4: client_agency_connections – SELECT-Policy aus schema.sql entfernen
--
-- Problem: schema.sql enthält:
--   CREATE POLICY "Agencies can read connections where they are agency"
--     USING (agency_id IN (SELECT id FROM public.agencies))
--
--   Dies erlaubt JEDEM authentifizierten User (inkl. Models, Clients anderer
--   Orgs), alle Client-Agentur-Verbindungen zu lesen, weil
--   (SELECT id FROM public.agencies) alle Agenturen zurückgibt.
--
--   Nachfolgende Migrations (migration_connection_messenger_org_scope.sql)
--   haben INSERT/UPDATE-Policies ersetzt, aber diese SELECT-Policy NICHT
--   explizit gedroppt.
--
-- Fix:
--   1. Breite Policy droppen.
--   2. Org-scoped SELECT-Policies für Client-Org-Mitglieder und Agency-Org-
--      Mitglieder hinzufügen (analog zu bestehenden INSERT/UPDATE-Policies).
-- =============================================================================

-- ─── DROP der breiten Legacy-Policies ────────────────────────────────────────
DROP POLICY IF EXISTS "Agencies can read connections where they are agency" ON public.client_agency_connections;
DROP POLICY IF EXISTS "Clients can read own connections"                     ON public.client_agency_connections;

-- ─── SELECT: Client (direkt oder via Org-Mitgliedschaft) ─────────────────────
CREATE POLICY "client_connections_select"
  ON public.client_agency_connections FOR SELECT
  TO authenticated
  USING (
    -- Direct client owner of the connection row
    client_id = auth.uid()
    -- Or: any member of the client's organisation
    OR EXISTS (
      SELECT 1
      FROM public.organization_members m1
      JOIN public.organization_members m2 ON m1.organization_id = m2.organization_id
      JOIN public.organizations o ON o.id = m1.organization_id AND o.type = 'client'
      WHERE m1.user_id = auth.uid()
        AND m2.user_id = client_agency_connections.client_id
    )
  );

-- ─── SELECT: Agency-Org-Mitglieder sehen ihre eigenen Connections ─────────────
CREATE POLICY "agency_connections_select"
  ON public.client_agency_connections FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.organizations o
      JOIN public.organization_members m ON m.organization_id = o.id AND m.user_id = auth.uid()
      WHERE o.type      = 'agency'
        AND o.agency_id = client_agency_connections.agency_id
    )
  );

-- ─── Verifikation (optional, als Kommentar) ───────────────────────────────────
-- SELECT policyname, cmd, qual FROM pg_policies
-- WHERE tablename = 'client_agency_connections' ORDER BY cmd, policyname;
