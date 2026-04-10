-- =============================================================================
-- 20260536: Guest Magic-Link — conversations + messages INSERT RLS
--
-- Live audit: conversations_insert_creator (C-4) requires agency org membership
-- when agency_organization_id is set; guests are not organization_members →
-- createGuestConversation() INSERT failed.
--
-- messages_insert_sender requires has_platform_access(); guests have no org →
-- can_access_platform no_org. A second policy "Org members can send messages"
-- may OR-bypass today; tighten messages_insert_sender explicitly for guest rows
-- so behavior survives policy cleanups.
--
-- get_guest_link_models: verified no can_access_platform / has_platform_access.
-- =============================================================================

-- ─── 1) conversations INSERT — guest ↔ agency thread (direct, guest_user_id) ─

DROP POLICY IF EXISTS conversations_insert_creator ON public.conversations;

CREATE POLICY conversations_insert_creator
  ON public.conversations
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = ANY (participant_ids)
    AND (created_by IS NULL OR created_by = auth.uid())
    AND (
      (
        client_organization_id IS NULL
        AND agency_organization_id IS NULL
      )
      OR (
        client_organization_id IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM   public.organization_members om
          WHERE  om.organization_id = conversations.client_organization_id
            AND  om.user_id = auth.uid()
        )
      )
      OR (
        agency_organization_id IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM   public.organization_members om
          WHERE  om.organization_id = conversations.agency_organization_id
            AND  om.user_id = auth.uid()
        )
      )
      OR (
        guest_user_id = auth.uid()
        AND auth.uid() = ANY (participant_ids)
        AND agency_organization_id IS NOT NULL
        AND client_organization_id IS NULL
        AND type = 'direct'::public.conversation_type
      )
    )
  );

COMMENT ON POLICY conversations_insert_creator ON public.conversations IS
  'C-4 org validation + 20260536: guest Magic-Link may create direct conversation '
  'with agency_organization_id when guest_user_id = auth.uid() (no org membership).';

-- ─── 2) messages INSERT — paywall OR designated guest on conversation ───────

DROP POLICY IF EXISTS messages_insert_sender ON public.messages;

CREATE POLICY messages_insert_sender
  ON public.messages
  FOR INSERT
  TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND public.conversation_accessible_to_me(conversation_id)
    AND (
      public.has_platform_access()
      OR EXISTS (
        SELECT 1
        FROM   public.conversations c
        WHERE  c.id = conversation_id
          AND  c.guest_user_id IS NOT NULL
          AND  c.guest_user_id = auth.uid()
      )
    )
  );

COMMENT ON POLICY messages_insert_sender ON public.messages IS
  'B2B: paywall + accessible conversation. 20260536: Magic-Link guests may send '
  'when conversations.guest_user_id = auth.uid() (no has_platform_access).';

-- ─── Verification ─────────────────────────────────────────────────────────────

DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1
    FROM   pg_policies
    WHERE  schemaname = 'public'
      AND  tablename = 'conversations'
      AND  policyname = 'conversations_insert_creator'
      AND  cmd = 'INSERT'
  ), 'FAIL: conversations_insert_creator missing';

  ASSERT EXISTS (
    SELECT 1
    FROM   pg_policies
    WHERE  schemaname = 'public'
      AND  tablename = 'messages'
      AND  policyname = 'messages_insert_sender'
      AND  cmd = 'INSERT'
  ), 'FAIL: messages_insert_sender missing';

  ASSERT EXISTS (
    SELECT 1
    FROM   pg_policies
    WHERE  schemaname = 'public'
      AND  tablename = 'messages'
      AND  policyname = 'messages_insert_sender'
      AND  with_check::text ILIKE '%guest_user_id%'
  ), 'FAIL: messages_insert_sender missing guest_user_id bypass';
END $$;
