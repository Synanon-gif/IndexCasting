-- =============================================================================
-- Invitations: nur Owner darf einladen
--
-- Problem: Die bestehende Policy invitations_insert_org_settings_members erlaubt
--   Agency: owner + booker   → zu weit (Booker soll nicht einladen dürfen)
--   Client: owner + employee → zu weit (Employee soll nicht einladen dürfen)
--
-- Fix: INSERT einschränken auf role = 'owner' in der jeweiligen Org.
--   SELECT bleibt für alle Mitglieder (owner + booker/employee) sichtbar,
--   damit Mitglieder die bestehenden Einladungen ihres Teams sehen können.
-- =============================================================================

-- ─── SELECT: alle Org-Mitglieder dürfen Einladungsliste sehen ────────────────
DROP POLICY IF EXISTS invitations_select_org_settings_members ON public.invitations;
DROP POLICY IF EXISTS "invitations_select_owner_only"         ON public.invitations;

CREATE POLICY invitations_select_org_settings_members
  ON public.invitations FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.organizations o
      JOIN public.organization_members m ON m.organization_id = o.id
      WHERE o.id    = invitations.organization_id
        AND m.user_id = auth.uid()
        AND (
          (o.type = 'agency' AND m.role IN ('owner', 'booker'))
          OR
          (o.type = 'client' AND m.role IN ('owner', 'employee'))
        )
    )
  );

-- ─── INSERT: nur Owner darf neue Einladungen verschicken ─────────────────────
DROP POLICY IF EXISTS invitations_insert_org_settings_members ON public.invitations;
DROP POLICY IF EXISTS "invitations_insert_owner_only"         ON public.invitations;

CREATE POLICY invitations_insert_owner_only
  ON public.invitations FOR INSERT
  TO authenticated
  WITH CHECK (
    invited_by = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.organizations o
      JOIN public.organization_members m ON m.organization_id = o.id
      WHERE o.id      = organization_id
        AND m.user_id = auth.uid()
        AND m.role    = 'owner'
    )
  );
