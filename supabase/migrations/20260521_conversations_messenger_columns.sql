-- =============================================================================
-- Client messenger: ensure conversations columns match CONVERSATION_SELECT in
-- src/services/messengerSupabase.ts (fixes PostgREST 400 on unknown columns).
-- Previously only in root SQL (e.g. migration_guest_user_flow.sql,
-- migration_connection_messenger_org_scope.sql), not guaranteed on Live DB.
-- Idempotent. Safe to re-run.
-- =============================================================================

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS client_organization_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL;

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS agency_organization_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL;

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS guest_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_client_org ON public.conversations(client_organization_id);
CREATE INDEX IF NOT EXISTS idx_conversations_agency_org ON public.conversations(agency_organization_id);

CREATE INDEX IF NOT EXISTS idx_conversations_guest_user
  ON public.conversations(guest_user_id)
  WHERE guest_user_id IS NOT NULL;

COMMENT ON COLUMN public.conversations.guest_user_id IS
  'Set when the conversation was started by a guest (Magic-Link) user. '
  'Lets the agency UI label the chat as Guest Client.';

DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'conversations' AND column_name = 'guest_user_id'
  ), 'FAIL: conversations.guest_user_id missing after 20260521 migration';
END;
$$;
