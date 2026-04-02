-- =============================================================================
-- Org Role Model Enforcement
--
-- Regeln:
--   Agency-Orgs: role IN ('owner', 'booker')
--   Client-Orgs: role IN ('owner', 'employee')
--
-- Durchsetzung auf drei Ebenen:
--   1. BEFORE INSERT OR UPDATE Trigger auf organization_members
--   2. SECURITY DEFINER Hilfsfunktion check_org_access() für RLS-Policies
--   3. SECURITY DEFINER RPC get_my_org_context() für den Frontend-Auth-Context
--   4. Aktualisierte RLS-Policies auf organization_members
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Trigger: Role-Typ-Binding auf organization_members
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.validate_org_member_role_for_type()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_type organization_type;
BEGIN
  SELECT type INTO v_org_type
  FROM public.organizations
  WHERE id = NEW.organization_id;

  IF v_org_type IS NULL THEN
    RAISE EXCEPTION 'org_not_found: organization % does not exist', NEW.organization_id;
  END IF;

  IF v_org_type = 'agency' AND NEW.role NOT IN ('owner', 'booker') THEN
    RAISE EXCEPTION 'invalid_role_for_org_type: role % is not valid for agency organizations (allowed: owner, booker)', NEW.role;
  END IF;

  IF v_org_type = 'client' AND NEW.role NOT IN ('owner', 'employee') THEN
    RAISE EXCEPTION 'invalid_role_for_org_type: role % is not valid for client organizations (allowed: owner, employee)', NEW.role;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_org_member_role ON public.organization_members;
CREATE TRIGGER trg_validate_org_member_role
  BEFORE INSERT OR UPDATE OF role, organization_id
  ON public.organization_members
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_org_member_role_for_type();

-- -----------------------------------------------------------------------------
-- 2. Unified Access-Helper: check_org_access()
--
-- Prüft alle drei Bedingungen auf einmal:
--   a) Org-Grenze: user ist Mitglied der angegebenen Org
--   b) Org-Typ: organizations.type = p_expected_org_type
--   c) Rollen-Gültigkeit: role = ANY(p_required_roles)
--
-- Gibt true zurück wenn alle drei erfüllt sind, sonst false.
-- SECURITY DEFINER wegen organisation_members-Lesezugriff im RLS-Kontext.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.check_org_access(
  p_org_id          uuid,
  p_expected_org_type organization_type,
  p_required_roles  org_member_role[]
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_members m
    JOIN public.organizations o ON o.id = m.organization_id
    WHERE m.organization_id = p_org_id
      AND m.user_id         = auth.uid()
      AND o.type            = p_expected_org_type
      AND m.role            = ANY(p_required_roles)
  );
$$;

REVOKE ALL ON FUNCTION public.check_org_access(uuid, organization_type, org_member_role[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_org_access(uuid, organization_type, org_member_role[]) TO authenticated;

-- -----------------------------------------------------------------------------
-- 3. RPC: get_my_org_context()
--
-- Gibt organization_id, org_type und org_member_role des aktuellen Nutzers zurück.
-- Wird vom Frontend-AuthContext beim Laden des Profils aufgerufen.
-- Gibt NULL zurück wenn der Nutzer kein Org-Mitglied ist (z. B. Models, Guests).
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_my_org_context()
RETURNS TABLE(
  organization_id uuid,
  org_type        organization_type,
  org_member_role org_member_role
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    m.organization_id,
    o.type          AS org_type,
    m.role          AS org_member_role
  FROM public.organization_members m
  JOIN public.organizations o ON o.id = m.organization_id
  WHERE m.user_id = auth.uid()
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_my_org_context() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_org_context() TO authenticated;

-- -----------------------------------------------------------------------------
-- 4. RLS-Policies auf organization_members
--
-- SELECT: Mitglied darf nur Zeilen der eigenen Org sehen, wenn Org-Typ + Rolle stimmt.
-- INSERT: Nur Owner einer Org darf neue Mitglieder eintragen (via check_org_access).
-- UPDATE: Nur Owner darf Rollen ändern.
-- DELETE: Nur Owner darf Mitglieder entfernen (eigene Zeile: jeder für sich).
-- -----------------------------------------------------------------------------

-- SELECT
DROP POLICY IF EXISTS org_members_select ON public.organization_members;
CREATE POLICY org_members_select
  ON public.organization_members FOR SELECT
  TO authenticated
  USING (
    -- Agency-Member darf Agency-Org-Zeilen sehen
    check_org_access(organization_id, 'agency', ARRAY['owner','booker']::org_member_role[])
    OR
    -- Client-Member darf Client-Org-Zeilen sehen
    check_org_access(organization_id, 'client', ARRAY['owner','employee']::org_member_role[])
  );

-- INSERT: Nur Owner kann neue Mitglieder hinzufügen
DROP POLICY IF EXISTS org_members_insert ON public.organization_members;
CREATE POLICY org_members_insert
  ON public.organization_members FOR INSERT
  TO authenticated
  WITH CHECK (
    check_org_access(organization_id, 'agency', ARRAY['owner']::org_member_role[])
    OR
    check_org_access(organization_id, 'client', ARRAY['owner']::org_member_role[])
  );

-- UPDATE: Nur Owner kann Rollen ändern
DROP POLICY IF EXISTS org_members_update ON public.organization_members;
CREATE POLICY org_members_update
  ON public.organization_members FOR UPDATE
  TO authenticated
  USING (
    check_org_access(organization_id, 'agency', ARRAY['owner']::org_member_role[])
    OR
    check_org_access(organization_id, 'client', ARRAY['owner']::org_member_role[])
  )
  WITH CHECK (
    check_org_access(organization_id, 'agency', ARRAY['owner']::org_member_role[])
    OR
    check_org_access(organization_id, 'client', ARRAY['owner']::org_member_role[])
  );

-- DELETE: Owner kann jeden entfernen; jedes Mitglied kann sich selbst entfernen
DROP POLICY IF EXISTS org_members_delete ON public.organization_members;
CREATE POLICY org_members_delete
  ON public.organization_members FOR DELETE
  TO authenticated
  USING (
    user_id = auth.uid()
    OR
    check_org_access(organization_id, 'agency', ARRAY['owner']::org_member_role[])
    OR
    check_org_access(organization_id, 'client', ARRAY['owner']::org_member_role[])
  );

-- -----------------------------------------------------------------------------
-- Grants für validate_org_member_role_for_type (Trigger-Funktion, kein Public-Grant)
-- -----------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.validate_org_member_role_for_type() FROM PUBLIC;
