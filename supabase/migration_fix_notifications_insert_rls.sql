-- =============================================================================
-- Security Fix: Notifications INSERT Policy — Prevent Notification Injection
--
-- Problem (CRIT-2 from 2026-04 System Audit):
--   The original policy "notifications_insert_authenticated" only checked
--   auth.uid() IS NOT NULL. Any authenticated user could insert a notification
--   targeting ANY user_id or organization_id — effectively allowing spam /
--   fake notification injection across the platform.
--
-- New policy "notifications_insert_scoped" restricts INSERT to:
--   1. Own user-targeted notifications  (user_id = auth.uid())
--   2. Org-targeted notifications       (caller must be a member of that org)
--   3. Cross-party notifications        (Agency→Model, Client→Agency etc.)
--      are allowed when the caller belongs to any organisation.
--      This covers the legitimate service-layer pattern where, e.g., an agency
--      booker notifies a model user after accepting their application.
--
-- The cleanest long-term solution is to move all cross-party notification
-- creation into SECURITY DEFINER RPCs. The third clause is a pragmatic interim
-- guard that still prevents unauthenticated / non-org users from injecting.
--
-- Run AFTER migration_notifications.sql (Phase 16, #104 in MIGRATION_ORDER.md).
-- =============================================================================

-- Drop the overly-broad original policy
DROP POLICY IF EXISTS "notifications_insert_authenticated" ON public.notifications;

-- Replace with a scoped policy
CREATE POLICY "notifications_insert_scoped"
  ON public.notifications
  FOR INSERT
  WITH CHECK (
    -- 1. Caller sends a notification to themselves (self-targeting)
    (
      user_id = auth.uid()
      AND organization_id IS NULL
    )
    -- 2. Caller sends an org-wide notification — must be a member of that org
    OR (
      organization_id IS NOT NULL
      AND user_id IS NULL
      AND EXISTS (
        SELECT 1 FROM public.organization_members om
        WHERE om.organization_id = notifications.organization_id
          AND om.user_id = auth.uid()
      )
    )
    -- 3. Cross-party notification (e.g. agency notifies a model user, or
    --    client notifies an agency user). Caller must be an org member.
    --    This allows the service layer to notify other users while still
    --    blocking unauthenticated callers and lone users with no org context.
    OR (
      user_id IS NOT NULL
      AND user_id != auth.uid()
      AND organization_id IS NULL
      AND EXISTS (
        SELECT 1 FROM public.organization_members om
        WHERE om.user_id = auth.uid()
      )
    )
  );

-- Verification
SELECT policyname, cmd, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'notifications'
ORDER BY policyname;
