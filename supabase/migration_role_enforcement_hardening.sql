-- =============================================================================
-- Fix 5: Rollen-Enforcement Hardening
--
-- VORHANDENE SCHUTZMECHANISMEN (unveraendert):
--   1. ENUM org_member_role: nur 'owner','booker','employee' moeglich
--   2. BEFORE INSERT OR UPDATE Trigger validate_org_member_role_for_type:
--      Agency → owner/booker | Client → owner/employee
--   3. check_org_access() SECURITY DEFINER: Org-Grenze + Typ + Rolle in einer Funktion
--   4. RLS organization_members: Owner-only INSERT/UPDATE/DELETE via check_org_access
--   5. dissolve_organization: prüft owner_id direkt (ausreichend)
--
-- ERGAENZUNGEN HIER:
--   A. remove_org_member() RPC: sicherer Wrapper für Owner-only Member-Removal
--   B. option_requests INSERT-Policy: sicherstellen dass Booker (agency) schreiben dürfen
-- =============================================================================

-- -----------------------------------------------------------------------------
-- A. remove_org_member — sicherer Owner-only Wrapper (SECURITY DEFINER)
-- -----------------------------------------------------------------------------
-- Nutzt check_org_access() als Guard statt direktem DELETE über RLS.
-- Verhindert: dass Frontend direkt DELETE auf organization_members feuert.
-- Schutzmechanismus: nur Owner der Org kann entfernen; sich selbst kann jeder entfernen.

CREATE OR REPLACE FUNCTION public.remove_org_member(
  p_organization_id uuid,
  p_user_id         uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  -- Eigenes Membership: jeder darf sich selbst entfernen
  IF p_user_id = auth.uid() THEN
    DELETE FROM public.organization_members
    WHERE organization_id = p_organization_id AND user_id = p_user_id;
    RETURN jsonb_build_object('ok', true, 'removed_self', true);
  END IF;

  -- Fremdes Membership: nur Owner der Org darf entfernen (via check_org_access)
  IF NOT (
    public.check_org_access(p_organization_id, 'agency', ARRAY['owner']::org_member_role[])
    OR
    public.check_org_access(p_organization_id, 'client', ARRAY['owner']::org_member_role[])
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden_not_owner');
  END IF;

  DELETE FROM public.organization_members
  WHERE organization_id = p_organization_id AND user_id = p_user_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.remove_org_member(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.remove_org_member(uuid, uuid) TO authenticated;

-- -----------------------------------------------------------------------------
-- B. option_requests INSERT-Policy: Agency-Booker-Zugriff explizit absichern
--
-- Aktuell: option_requests_insert prüft client_organization_id + organization_members.
-- Ergänzung: Booker einer Agency-Org dürfen ebenfalls inserieren (für Agency-initiated Requests).
-- Prüft: user ist Mitglied der agency_organization (owner oder booker).
-- -----------------------------------------------------------------------------

DROP POLICY IF EXISTS "option_requests_insert_agency" ON public.option_requests;

CREATE POLICY "option_requests_insert_agency"
  ON public.option_requests FOR INSERT
  TO authenticated
  WITH CHECK (
    -- Agency-Mitglied (owner oder booker) kann option_request für eigene Org anlegen
    agency_organization_id IS NOT NULL
    AND public.check_org_access(
      agency_organization_id,
      'agency',
      ARRAY['owner', 'booker']::org_member_role[]
    )
  );

-- -----------------------------------------------------------------------------
-- Verifikation: Trigger ist aktiv (informational, keine Aktion)
-- -----------------------------------------------------------------------------
-- SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.organization_members'::regclass
--   AND tgname = 'trg_validate_org_member_role';
-- Erwartet: 1 Zeile → Trigger aktiv
