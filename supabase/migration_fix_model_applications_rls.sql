-- =============================================================================
-- SECURITY FIX: model_applications – UPDATE + INSERT RLS verschärfen
--
-- Problem 1: "Authenticated can update applications" USING(true)
--   Jeder authentifizierte User konnte jede Bewerbung updaten (Status ändern,
--   Daten überschreiben). Das erlaubte z.B. Clients, Bewerbungen anderer
--   Agenturen auf 'accepted' zu setzen oder Inhalte zu manipulieren.
--
-- Problem 2: "Authenticated can insert applications" WITH CHECK(true)
--   Kein Schutz der applicant_user_id — ein eingeloggter User konnte fremde
--   user_ids als applicant_user_id eintragen.
--
-- Fix:
--   UPDATE: Nur Agency-Org-Mitglieder der zuständigen Agentur (agency_id oder
--     accepted_by_agency_id) und der Bewerber selbst (nur wenn status=pending)
--     dürfen updaten.
--   INSERT: applicant_user_id muss auth.uid() sein oder NULL bleiben (für
--     anon-Bewerbungen ohne Account). Verhindert User-ID-Spoofing.
-- =============================================================================

-- ─── UPDATE: Agency-Mitglieder + eigener Bewerber ────────────────────────────
DROP POLICY IF EXISTS "Authenticated can update applications"              ON public.model_applications;
DROP POLICY IF EXISTS "model_applications_update_agency_or_applicant"      ON public.model_applications;

CREATE POLICY "model_applications_update_agency_or_applicant"
  ON public.model_applications FOR UPDATE
  TO authenticated
  USING (
    -- Agency-Org-Mitglied der Zielagentur (primary: agency_id)
    (
      agency_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.organization_members om
        JOIN public.organizations o ON o.id = om.organization_id
        WHERE om.user_id  = auth.uid()
          AND o.agency_id = model_applications.agency_id
      )
    )
    -- Agency-Org-Mitglied der akzeptierenden Agentur (multi-agency accept flow)
    OR (
      accepted_by_agency_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.organization_members om
        JOIN public.organizations o ON o.id = om.organization_id
        WHERE om.user_id  = auth.uid()
          AND o.agency_id = model_applications.accepted_by_agency_id
      )
    )
    -- Der Bewerber selbst darf seine eigene pending Bewerbung editieren
    OR (
      applicant_user_id = auth.uid()
      AND status = 'pending'
    )
  )
  WITH CHECK (
    (
      agency_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.organization_members om
        JOIN public.organizations o ON o.id = om.organization_id
        WHERE om.user_id  = auth.uid()
          AND o.agency_id = model_applications.agency_id
      )
    )
    OR (
      accepted_by_agency_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.organization_members om
        JOIN public.organizations o ON o.id = om.organization_id
        WHERE om.user_id  = auth.uid()
          AND o.agency_id = model_applications.accepted_by_agency_id
      )
    )
    OR (
      applicant_user_id = auth.uid()
      AND status = 'pending'
    )
  );

-- ─── INSERT: applicant_user_id nur für eigenen User oder anon ─────────────────
-- Anmerkung: Das Bewerbungsformular ist öffentlich zugänglich (apply form).
--   Authentifizierte Bewerber: applicant_user_id muss auth.uid() sein.
--   Anon-Bewerber (ohne Account): applicant_user_id IS NULL erlaubt.
--   → Verhindert, dass ein eingeloggter User fremde user_ids hinterlegt.
DROP POLICY IF EXISTS "Authenticated can insert applications"              ON public.model_applications;
DROP POLICY IF EXISTS "model_applications_insert_own_or_anon"              ON public.model_applications;

CREATE POLICY "model_applications_insert_own_or_anon"
  ON public.model_applications FOR INSERT
  TO authenticated
  WITH CHECK (
    applicant_user_id = auth.uid()
    OR applicant_user_id IS NULL
  );

-- Anon-Zugriff für das öffentliche Bewerbungsformular (falls RLS für anon nicht komplett off ist):
-- Falls der apply-flow über eine anon-Session läuft, muss die Policy auch für 'anon' gelten.
DROP POLICY IF EXISTS "Anon can insert applications"                        ON public.model_applications;

CREATE POLICY "Anon can insert applications"
  ON public.model_applications FOR INSERT
  TO anon
  WITH CHECK (applicant_user_id IS NULL);

-- ─── Verifikation ─────────────────────────────────────────────────────────────
-- SELECT policyname, cmd, qual, with_check
-- FROM pg_policies
-- WHERE tablename = 'model_applications'
-- ORDER BY cmd, policyname;
