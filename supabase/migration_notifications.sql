-- =============================================================================
-- MIGRATION: notifications
-- Creates the notifications table with RLS policies.
-- Run once against the production/staging Supabase project.
-- =============================================================================

-- ── Table ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS notifications (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id uuid        REFERENCES organizations(id) ON DELETE CASCADE,
  type            text        NOT NULL,
  title           text        NOT NULL,
  message         text        NOT NULL,
  metadata        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  is_read         boolean     NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notifications_target_check CHECK (
    user_id IS NOT NULL OR organization_id IS NOT NULL
  )
);

COMMENT ON TABLE notifications IS
  'Platform notifications for users and organizations. Each row targets either a specific user (user_id) or every member of an organization (organization_id).';

-- ── Indexes ──────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS notifications_user_id_is_read_idx
  ON notifications (user_id, is_read)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS notifications_organization_id_idx
  ON notifications (organization_id)
  WHERE organization_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS notifications_created_at_idx
  ON notifications (created_at DESC);

-- ── Row Level Security ────────────────────────────────────────────────────────

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- SELECT: user sees own notifications OR notifications addressed to any org they belong to
CREATE POLICY "notifications_select_own_or_org"
  ON notifications
  FOR SELECT
  USING (
    user_id = auth.uid()
    OR organization_id IN (
      SELECT organization_id
      FROM organization_members
      WHERE user_id = auth.uid()
    )
  );

-- INSERT: any authenticated user may create a notification (notification text is
--         non-sensitive; triggered by app code on behalf of other users).
CREATE POLICY "notifications_insert_authenticated"
  ON notifications
  FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- UPDATE: user may only mark their own (or their org's) notifications as read.
CREATE POLICY "notifications_update_own_or_org"
  ON notifications
  FOR UPDATE
  USING (
    user_id = auth.uid()
    OR organization_id IN (
      SELECT organization_id
      FROM organization_members
      WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    user_id = auth.uid()
    OR organization_id IN (
      SELECT organization_id
      FROM organization_members
      WHERE user_id = auth.uid()
    )
  );

-- DELETE: users can delete their own notifications (optional cleanup)
CREATE POLICY "notifications_delete_own_or_org"
  ON notifications
  FOR DELETE
  USING (
    user_id = auth.uid()
    OR organization_id IN (
      SELECT organization_id
      FROM organization_members
      WHERE user_id = auth.uid()
    )
  );
