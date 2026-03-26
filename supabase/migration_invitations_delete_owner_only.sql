-- =============================================================================
-- SECURITY FIX: invitations – DELETE-Policy für Owner
--
-- Problem: Die invitations-Tabelle hatte keine DELETE-Policy. Ein Owner
--   konnte eine einmal versendete Einladung nicht widerrufen. Eine kompromit-
--   tierte oder versehentlich versendete Einladung blieb bis zum Ablauf (48h)
--   aktiv und war von jedem mit dem Token einlösbar.
--
-- Fix:
--   1. DELETE-Policy: nur Owner der jeweiligen Org darf pending Einladungen löschen.
--   2. UPDATE-Policy: Owner darf status auf 'revoked' setzen (für Audit-Trail).
--      → Erfordert 'revoked' als neuen Wert im invitation_status Enum (optional,
--        als Alternative zum Hard-Delete).
--
-- Diese Migration nutzt Hard-Delete (DELETE) als Primary-Flow.
-- =============================================================================

-- ─── DELETE: nur Owner darf pending Einladungen seiner Org löschen ───────────
DROP POLICY IF EXISTS invitations_delete_owner_only ON public.invitations;

CREATE POLICY invitations_delete_owner_only
  ON public.invitations FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.organization_members m
      WHERE m.organization_id = invitations.organization_id
        AND m.user_id         = auth.uid()
        AND m.role            = 'owner'
    )
    AND invitations.status = 'pending'
  );

COMMENT ON POLICY invitations_delete_owner_only ON public.invitations IS
  'Only the org owner can delete (revoke) their own pending invitations. '
  'Accepted invitations cannot be deleted via this policy.';
