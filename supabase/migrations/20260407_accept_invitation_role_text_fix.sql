-- ============================================================================
-- Fix: accept_organization_invitation — prole TEXT statt public.user_role
--
-- Bug: accept_organization_invitation() deklariert `prole public.user_role`.
-- Wenn die Live-DB den user_role ENUM noch kennt, schlägt die implicit cast
-- TEXT → user_role für Werte wie 'admin' oder 'guest' zur Laufzeit fehl.
--
-- Fix: Variable auf TEXT geändert. Die Logik ist unverändert — prole wird
-- nur gegen 'agent' und 'client' verglichen, was mit TEXT genauso funktioniert.
--
-- Supersedes: migration_security_invitation_email_guard.sql (selbe Funktion,
--             gleiche Logik, nur Typfehler korrigiert).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.accept_organization_invitation(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inv     public.invitations%ROWTYPE;
  org     public.organizations%ROWTYPE;
  uemail  text;
  prole   text;   -- ← was: public.user_role (caused enum cast error for admin/guest)
  mem_cnt int;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  SELECT email INTO uemail FROM auth.users WHERE id = auth.uid();

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

  IF lower(trim(COALESCE(uemail, ''))) IS DISTINCT FROM lower(trim(COALESCE(inv.email, ''))) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'email_mismatch');
  END IF;

  SELECT * INTO org FROM public.organizations WHERE id = inv.organization_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'org_not_found');
  END IF;

  -- SECURITY CHECK: Profile role must match the org type.
  -- Read as TEXT to avoid enum cast failure for admin/guest.
  SELECT role::text INTO prole FROM public.profiles WHERE id = auth.uid();

  IF org.type = 'agency' AND inv.role = 'booker' AND prole IS DISTINCT FROM 'agent' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'wrong_profile_role', 'expected', 'agent');
  END IF;

  IF org.type = 'client' AND inv.role IN ('employee', 'owner') AND prole IS DISTINCT FROM 'client' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'wrong_profile_role', 'expected', 'client');
  END IF;

  SELECT COUNT(*) INTO mem_cnt
  FROM public.organization_members
  WHERE user_id = auth.uid()
    AND organization_id <> inv.organization_id;

  IF mem_cnt > 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_member_of_another_org');
  END IF;

  BEGIN
    UPDATE public.invitations
    SET status = 'accepted'
    WHERE id = inv.id;
  EXCEPTION WHEN undefined_column THEN
    UPDATE public.invitations
    SET accepted_at = now(), accepted_by = auth.uid()
    WHERE id = inv.id;
  END;

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
  'Fixed: prole variable changed from user_role enum to text (20260407).';
