-- Phase 2B: B2B conversation partner can read the counterparty's org profile.
-- Adds a SECURITY DEFINER helper + 2 SELECT-only RLS policies.
-- No LIMIT 1 (Risiko 10 compliant), no profiles/models reference (no recursion risk).

-- ─── Helper ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.has_b2b_conversation_with_org(p_target_org_id uuid)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN false; END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.conversations c
    JOIN public.organization_members om ON om.user_id = auth.uid()
    WHERE (
      (c.client_organization_id = om.organization_id AND c.agency_organization_id = p_target_org_id)
      OR
      (c.agency_organization_id = om.organization_id AND c.client_organization_id = p_target_org_id)
    )
  );
END;
$$;

-- ─── RLS policies ─────────────────────────────────────────────────────────────

-- organization_profiles: B2B chat partner can read counterparty profile
CREATE POLICY "op_b2b_partner_select"
  ON public.organization_profiles
  FOR SELECT
  TO authenticated
  USING (public.has_b2b_conversation_with_org(organization_id));

-- organization_profile_media: B2B chat partner can read counterparty profile media
CREATE POLICY "opm_b2b_partner_select"
  ON public.organization_profile_media
  FOR SELECT
  TO authenticated
  USING (public.has_b2b_conversation_with_org(organization_id));
