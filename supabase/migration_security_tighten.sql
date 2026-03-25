-- =============================================================================
-- Security Tighten (P5)
--
-- Schließt weit-offene Policies, die aus frühen Migrations-Phasen stammen:
--   1. bookers: Anon kann lesen + schreiben → beschränken
--   2. model_applications: SELECT USING(true) → eigene + Agency-seitige Sicht
--   3. agency_invitations / option_documents: ALL USING(true) → Auth-only
-- =============================================================================

-- =============================================================================
-- 1. bookers-Tabelle
--    Anon hat keinerlei Schreibrecht; Lesen bleibt authentifizierten Usern.
--    Agency-Mitglieder dürfen INSERT/UPDATE; Deletes nur Agentur-Owner/-Booker.
-- =============================================================================
DROP POLICY IF EXISTS "Anyone can read bookers"      ON public.bookers;
DROP POLICY IF EXISTS "Authenticated can manage bookers" ON public.bookers;
DROP POLICY IF EXISTS "Anon can read bookers"        ON public.bookers;
DROP POLICY IF EXISTS "Anon can insert bookers"      ON public.bookers;
DROP POLICY IF EXISTS "Anon can update bookers"      ON public.bookers;

-- Lesen: nur authentifizierte User (Agency-Kontext: eigene Booker-Zeile oder selbe Agentur)
CREATE POLICY "Authenticated can read bookers"
  ON public.bookers FOR SELECT TO authenticated
  USING (
    -- eigene Zeile
    user_id = auth.uid()
    -- oder Mitglied/Owner der gleichen Agentur
    OR EXISTS (
      SELECT 1
      FROM public.organizations o
      JOIN public.organization_members om ON om.organization_id = o.id
      WHERE o.agency_id = bookers.agency_id
        AND o.type      = 'agency'
        AND om.user_id  = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.organizations o
      WHERE o.agency_id = bookers.agency_id
        AND o.type      = 'agency'
        AND o.owner_id  = auth.uid()
    )
  );

-- INSERT / UPDATE: Agency Owner oder Org-Mitglied mit Rolle owner/booker
CREATE POLICY "Agency can manage bookers"
  ON public.bookers FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.organizations o
      WHERE o.agency_id = bookers.agency_id AND o.type = 'agency'
        AND (
          o.owner_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.organization_members om
            WHERE om.organization_id = o.id AND om.user_id = auth.uid()
              AND om.role IN ('owner', 'booker')
          )
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.organizations o
      WHERE o.agency_id = bookers.agency_id AND o.type = 'agency'
        AND (
          o.owner_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.organization_members om
            WHERE om.organization_id = o.id AND om.user_id = auth.uid()
              AND om.role IN ('owner', 'booker')
          )
        )
    )
  );


-- =============================================================================
-- 2. model_applications
--    Statt USING(true) (alle sehen alles) → Sicht auf eigene + Agency-seitige Anträge.
-- =============================================================================
DROP POLICY IF EXISTS "Authenticated can read applications" ON public.model_applications;

CREATE POLICY "Scoped can read model applications"
  ON public.model_applications FOR SELECT TO authenticated
  USING (
    -- Bewerber sieht eigene Zeile
    applicant_user_id = auth.uid()
    -- Agency-Mitglied sieht Bewerbungen für ihre Agentur
    OR EXISTS (
      SELECT 1
      FROM public.organizations o
      WHERE o.agency_id = model_applications.agency_id AND o.type = 'agency'
        AND (
          o.owner_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.organization_members om
            WHERE om.organization_id = o.id AND om.user_id = auth.uid()
          )
          OR EXISTS (
            SELECT 1 FROM public.bookers b
            WHERE b.agency_id = o.agency_id AND b.user_id = auth.uid()
          )
        )
    )
  );


-- =============================================================================
-- 3. agency_invitations + option_documents
--    Auth-only statt anon/everyone.
-- =============================================================================
DROP POLICY IF EXISTS "Anyone can manage invitations"     ON public.agency_invitations;
DROP POLICY IF EXISTS "Anyone can manage option documents" ON public.option_documents;

CREATE POLICY "Authenticated can manage agency invitations"
  ON public.agency_invitations FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated can manage option documents"
  ON public.option_documents FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
