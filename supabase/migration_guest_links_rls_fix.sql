-- =============================================================================
-- guest_links RLS: KORREKTUR der fehlerhaften agency-scoped Migration
--
-- Bug in migration_guest_links_rls_agency_scoped.sql:
--   Die Policies verglichen guest_links.agency_id (= agencies.id)
--   gegen organizations.id — das sind völlig verschiedene UUIDs.
--   Korrekt ist: organizations.agency_id = guest_links.agency_id
--
-- Diese Migration:
--   1. Entfernt die fehlerhaften Policies aus der vorherigen Migration
--   2. Erstellt korrekte Policies, die BEIDE Mitgliedschaftspfade abdecken:
--      a) bookers.agency_id  (direkter Booker-Link zur Agentur)
--      b) organizations.agency_id + organization_members / owner_id
--         (Einladungs-basierte Org-Mitgliedschaft)
-- =============================================================================

-- Drop fehlerhafte Policies aus der vorherigen Migration
DROP POLICY IF EXISTS "Agency members can insert own guest links"  ON public.guest_links;
DROP POLICY IF EXISTS "Agency members can update own guest links"  ON public.guest_links;
DROP POLICY IF EXISTS "Agency members can delete own guest links"  ON public.guest_links;
DROP POLICY IF EXISTS "Agency members can manage guest links"      ON public.guest_links;
DROP POLICY IF EXISTS "Agency users can write own guest links"     ON public.guest_links;

-- =============================================================================
-- Helper: Gibt TRUE zurück wenn auth.uid() zur angegebenen agency_id gehört.
-- Prüft:
--   1. bookers-Tabelle  (agency Booker mit direktem user_id-Link)
--   2. organizations-Zeile mit owner_id  (Organisations-Eigentümer)
--   3. organization_members + organizations.agency_id  (eingeladene Org-Mitglieder)
-- =============================================================================

-- INSERT
DROP POLICY IF EXISTS "Agency users can insert own guest links" ON public.guest_links;
CREATE POLICY "Agency users can insert own guest links"
  ON public.guest_links FOR INSERT TO authenticated
  WITH CHECK (
    -- Pfad 1: direkte booker-Zeile
    EXISTS (
      SELECT 1 FROM public.bookers b
      WHERE b.agency_id = agency_id
        AND b.user_id   = auth.uid()
    )
    OR
    -- Pfad 2: organizations.owner_id  (der Ersteller der Agency-Organisation)
    EXISTS (
      SELECT 1 FROM public.organizations o
      WHERE o.agency_id = agency_id
        AND o.owner_id  = auth.uid()
        AND o.type      = 'agency'
    )
    OR
    -- Pfad 3: organization_members (per Einladung beigetretene Booker / Team-Mitglieder)
    EXISTS (
      SELECT 1
      FROM public.organization_members om
      JOIN public.organizations o ON o.id = om.organization_id
      WHERE o.agency_id = agency_id
        AND o.type      = 'agency'
        AND om.user_id  = auth.uid()
    )
  );

-- UPDATE (z. B. deaktivieren)
DROP POLICY IF EXISTS "Agency users can update own guest links" ON public.guest_links;
CREATE POLICY "Agency users can update own guest links"
  ON public.guest_links FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.bookers b
      WHERE b.agency_id = agency_id AND b.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.organizations o
      WHERE o.agency_id = agency_id AND o.owner_id = auth.uid() AND o.type = 'agency'
    )
    OR EXISTS (
      SELECT 1
      FROM public.organization_members om
      JOIN public.organizations o ON o.id = om.organization_id
      WHERE o.agency_id = agency_id AND o.type = 'agency' AND om.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.bookers b
      WHERE b.agency_id = agency_id AND b.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.organizations o
      WHERE o.agency_id = agency_id AND o.owner_id = auth.uid() AND o.type = 'agency'
    )
    OR EXISTS (
      SELECT 1
      FROM public.organization_members om
      JOIN public.organizations o ON o.id = om.organization_id
      WHERE o.agency_id = agency_id AND o.type = 'agency' AND om.user_id = auth.uid()
    )
  );

-- DELETE
DROP POLICY IF EXISTS "Agency users can delete own guest links" ON public.guest_links;
CREATE POLICY "Agency users can delete own guest links"
  ON public.guest_links FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.bookers b
      WHERE b.agency_id = agency_id AND b.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.organizations o
      WHERE o.agency_id = agency_id AND o.owner_id = auth.uid() AND o.type = 'agency'
    )
    OR EXISTS (
      SELECT 1
      FROM public.organization_members om
      JOIN public.organizations o ON o.id = om.organization_id
      WHERE o.agency_id = agency_id AND o.type = 'agency' AND om.user_id = auth.uid()
    )
  );

-- SELECT-Policies bleiben unverändert (bereits korrekt):
--   "Anon can read guest links"                    → anon,          is_active = true
--   "Authenticated can read active guest links"    → authenticated, is_active = true
