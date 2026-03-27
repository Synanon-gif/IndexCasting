-- =============================================================================
-- Application Model Confirmation – STEP 2: RLS POLICY
--
-- WICHTIG: Erst ausführen NACHDEM migration_application_model_confirmation.sql
-- committet wurde. Der neue Enum-Wert 'pending_model_confirmation' muss bereits
-- in der DB existieren, bevor er in einer Policy referenziert werden kann.
--
-- Änderung gegenüber migration_fix_model_applications_rls.sql:
--   Der Applicant darf jetzt AUCH bei status = 'pending_model_confirmation'
--   updaten (um Accept / Reject zur Vertretungsanfrage zu senden).
--
-- FIX (Security Audit): WITH CHECK erlaubt jetzt 'accepted' und 'rejected'
--   als Zielzustände für den Bewerber-Zweig, sodass confirmApplicationByModel /
--   rejectApplicationByModel nicht durch RLS blockiert werden.
--   'pending_model_confirmation' bleibt aus WITH CHECK ausgeschlossen: der
--   Bewerber kann diesen Zustand nur lesen, nicht selbst setzen.
-- =============================================================================

DROP POLICY IF EXISTS "model_applications_update_agency_or_applicant" ON public.model_applications;

CREATE POLICY "model_applications_update_agency_or_applicant"
  ON public.model_applications FOR UPDATE
  TO authenticated
  USING (
    -- Agency-Org-Mitglied der Zielagentur (setzt pending → pending_model_confirmation)
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
    -- Agency-Org-Mitglied der akzeptierenden Agentur
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
    -- Bewerber darf eigene pending-Bewerbung editieren (Profilfelder)
    OR (
      applicant_user_id = auth.uid()
      AND status = 'pending'
    )
    -- Bewerber darf Vertretungsanfrage annehmen oder ablehnen
    OR (
      applicant_user_id = auth.uid()
      AND status = 'pending_model_confirmation'
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
    -- Bewerber: erlaubte Zielzustände:
    --   'pending'  → Profilfelder editieren (bleibt pending)
    --   'accepted' → Vertretungsanfrage annehmen (von pending_model_confirmation)
    --   'rejected' → Vertretungsanfrage ablehnen (von pending_model_confirmation)
    -- 'pending_model_confirmation' wird hier NICHT erlaubt: nur die Agentur darf
    -- diesen Status setzen.
    OR (
      applicant_user_id = auth.uid()
      AND status IN ('pending', 'accepted', 'rejected')
    )
  );

-- ─── Delete-Policy bleibt unverändert ─────────────────────────────────────────
-- Applicants dürfen pending und rejected Bewerbungen löschen (bestehende Policy).
-- pending_model_confirmation → kein Delete: Applicant soll Accept/Reject nutzen.
-- Die bestehende DELETE-Policy prüft IN ('pending','rejected'), keine Änderung nötig.
