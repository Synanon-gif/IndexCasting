-- =============================================================================
-- Fix: accept_organization_invitation — SET row_security TO off (PFLICHT)
--
-- PROBLEM (rls-security-patterns.mdc Risiko 4):
--   Die Funktion ist SECURITY DEFINER und liest RLS-geschützte Tabellen:
--   invitations, organizations, profiles, organization_members.
--   Ohne SET row_security TO off wertet PG15+ RLS innerhalb der Funktion aus
--   → latente Rekursionsgefahr / unerwartete leere Ergebnisse beim Login-Flow.
--
-- FIX:
--   SET row_security TO off hinzugefügt. Alle bisherigen Sicherheits-Checks
--   bleiben erhalten (email_mismatch, wrong_profile_role, already_member,
--   single-use via status=accepted, ON CONFLICT DO NOTHING).
--
-- Supersedes: 20260407_accept_invitation_role_text_fix.sql
--             (selbe Funktion, gleiche Logik, row_security-Flag ergänzt).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.accept_organization_invitation(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off   -- PFLICHT: Funktion liest mehrere RLS-geschützte Tabellen
AS $$
DECLARE
  inv     public.invitations%ROWTYPE;
  org     public.organizations%ROWTYPE;
  uemail  text;
  prole   text;   -- TEXT statt public.user_role (enum cast fehler vermieden, 20260407)
  mem_cnt int;
BEGIN
  -- GUARD 1: authentifiziert
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  -- E-Mail des eingeloggten Users aus auth.users lesen
  SELECT email INTO uemail FROM auth.users WHERE id = auth.uid();

  -- Token suchen: unterstützt beide Status-Modelle (status='pending' & accepted_at IS NULL)
  SELECT * INTO inv
  FROM public.invitations
  WHERE token = p_token
    AND (
      (status = 'pending' AND expires_at > now())
      OR
      (status IS NULL AND accepted_at IS NULL AND (expires_at IS NULL OR expires_at > now()))
    )
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_or_expired');
  END IF;

  -- SECURITY CHECK: E-Mail muss übereinstimmen
  IF lower(trim(COALESCE(uemail, ''))) IS DISTINCT FROM lower(trim(COALESCE(inv.email, ''))) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'email_mismatch');
  END IF;

  SELECT * INTO org FROM public.organizations WHERE id = inv.organization_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'org_not_found');
  END IF;

  -- SECURITY CHECK: Profil-Rolle muss zum Org-Typ passen
  -- TEXT um enum cast-Fehler für admin/guest zu vermeiden (Fix 20260407)
  SELECT role::text INTO prole FROM public.profiles WHERE id = auth.uid();

  IF org.type = 'agency' AND inv.role = 'booker' AND prole IS DISTINCT FROM 'agent' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'wrong_profile_role', 'expected', 'agent');
  END IF;

  IF org.type = 'client' AND inv.role IN ('employee', 'owner') AND prole IS DISTINCT FROM 'client' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'wrong_profile_role', 'expected', 'client');
  END IF;

  -- SECURITY CHECK: Single-Org-Invariante (kein Mitglied einer anderen Org)
  SELECT COUNT(*) INTO mem_cnt
  FROM public.organization_members
  WHERE user_id = auth.uid()
    AND organization_id <> inv.organization_id;

  IF mem_cnt > 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_member_of_another_org');
  END IF;

  -- Einladung als akzeptiert markieren (beide Schema-Varianten unterstützt)
  BEGIN
    UPDATE public.invitations
    SET status = 'accepted'
    WHERE id = inv.id;
  EXCEPTION WHEN undefined_column THEN
    UPDATE public.invitations
    SET accepted_at = now(), accepted_by = auth.uid()
    WHERE id = inv.id;
  END;

  -- Mitgliedschaft anlegen (idempotent)
  INSERT INTO public.organization_members (user_id, organization_id, role)
  VALUES (
    auth.uid(),
    inv.organization_id,
    CASE inv.role
      WHEN 'booker'   THEN 'booker'::public.org_member_role
      WHEN 'employee' THEN 'employee'::public.org_member_role
      WHEN 'owner'    THEN 'owner'::public.org_member_role
      ELSE                 'employee'::public.org_member_role
    END
  )
  ON CONFLICT (user_id, organization_id) DO NOTHING;

  RETURN jsonb_build_object('ok', true, 'organization_id', inv.organization_id);
END;
$$;

REVOKE ALL    ON FUNCTION public.accept_organization_invitation(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_organization_invitation(text) TO authenticated;

COMMENT ON FUNCTION public.accept_organization_invitation(text) IS
  'Secure invitation acceptance: validates token, email match, profile role, '
  'and single-org-per-user invariant before granting membership. '
  'Fixed: SET row_security TO off added (20260415, rls-security-patterns Risiko 4). '
  'Fixed: prole TEXT statt user_role enum (20260407).';

-- Verification
DO $$
BEGIN
  ASSERT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'accept_organization_invitation'),
    'FAIL: accept_organization_invitation function not found';
  RAISE NOTICE 'PASS: 20260415 — accept_organization_invitation now has SET row_security TO off';
END $$;
