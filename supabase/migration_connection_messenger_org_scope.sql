-- Bidirectional client↔agency connections + conversation org scope for RLS.
-- Run in Supabase SQL Editor after migration_client_agency_connections_org_chat_rls.sql
-- and migration_organizations_invitations_rls.sql
--
-- Treats public.client_agency_connections as the unified "connection_requests" (both directions).

-- ---------------------------------------------------------------------------
-- conversations: created_by + organization scope (optional; NULL = legacy rows)
-- ---------------------------------------------------------------------------
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS client_organization_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL;

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS agency_organization_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_client_org ON public.conversations(client_organization_id);
CREATE INDEX IF NOT EXISTS idx_conversations_agency_org ON public.conversations(agency_organization_id);

-- ---------------------------------------------------------------------------
-- Access helper: participant_ids OR member of scoped client/agency org
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.conversation_accessible_to_me(p_conv_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.conversations c
    WHERE c.id = p_conv_id
      AND (
        auth.uid() = ANY (c.participant_ids)
        OR (
          c.client_organization_id IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM public.organization_members m
            WHERE m.organization_id = c.client_organization_id
              AND m.user_id = auth.uid()
          )
        )
        OR (
          c.agency_organization_id IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM public.organization_members m
            WHERE m.organization_id = c.agency_organization_id
              AND m.user_id = auth.uid()
          )
        )
      )
  );
$$;

REVOKE ALL ON FUNCTION public.conversation_accessible_to_me(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.conversation_accessible_to_me(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- conversations: replace RLS
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Participants can read conversations" ON public.conversations;
DROP POLICY IF EXISTS "Authenticated can create conversations" ON public.conversations;
DROP POLICY IF EXISTS "Participants can update conversations" ON public.conversations;

CREATE POLICY "conversations_select_access"
  ON public.conversations FOR SELECT TO authenticated
  USING (public.conversation_accessible_to_me(id));

CREATE POLICY "conversations_insert_creator"
  ON public.conversations FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = ANY (participant_ids)
    AND (created_by IS NULL OR created_by = auth.uid())
  );

CREATE POLICY "conversations_update_access"
  ON public.conversations FOR UPDATE TO authenticated
  USING (public.conversation_accessible_to_me(id))
  WITH CHECK (public.conversation_accessible_to_me(id));

-- ---------------------------------------------------------------------------
-- messages: replace RLS
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Participants can read messages" ON public.messages;
DROP POLICY IF EXISTS "Participants can insert messages" ON public.messages;
DROP POLICY IF EXISTS "Sender or receiver can update messages (read receipts)" ON public.messages;

CREATE POLICY "messages_select_access"
  ON public.messages FOR SELECT TO authenticated
  USING (public.conversation_accessible_to_me(conversation_id));

CREATE POLICY "messages_insert_sender"
  ON public.messages FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND public.conversation_accessible_to_me(conversation_id)
  );

CREATE POLICY "messages_update_access"
  ON public.messages FOR UPDATE TO authenticated
  USING (public.conversation_accessible_to_me(conversation_id))
  WITH CHECK (public.conversation_accessible_to_me(conversation_id));

-- ---------------------------------------------------------------------------
-- client_agency_connections: INSERT (client → agency OR agency → client)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can create connection as client" ON public.client_agency_connections;

CREATE POLICY "Client creates connection request to agency"
  ON public.client_agency_connections FOR INSERT TO authenticated
  WITH CHECK (
    requested_by = 'client'
    AND client_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'client'
    )
  );

CREATE POLICY "Agency org creates connection request to client"
  ON public.client_agency_connections FOR INSERT TO authenticated
  WITH CHECK (
    requested_by = 'agency'
    AND EXISTS (
      SELECT 1
      FROM public.organizations o
      JOIN public.organization_members m ON m.organization_id = o.id AND m.user_id = auth.uid()
      WHERE o.type = 'agency'
        AND o.agency_id = client_agency_connections.agency_id
    )
  );

-- ---------------------------------------------------------------------------
-- client_agency_connections: UPDATE (accept / reject)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can update connection (accept/reject) if participant" ON public.client_agency_connections;
DROP POLICY IF EXISTS "Agency can update connection status" ON public.client_agency_connections;

CREATE POLICY "Client updates own connection rows"
  ON public.client_agency_connections FOR UPDATE TO authenticated
  USING (
    client_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.organization_members m1
      JOIN public.organization_members m2 ON m1.organization_id = m2.organization_id
      JOIN public.organizations o ON o.id = m1.organization_id AND o.type = 'client'
      WHERE m1.user_id = auth.uid()
        AND m2.user_id = client_agency_connections.client_id
    )
  )
  WITH CHECK (true);

CREATE POLICY "Agency org updates connection for their agency"
  ON public.client_agency_connections FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.organizations o
      JOIN public.organization_members m ON m.organization_id = o.id AND m.user_id = auth.uid()
      WHERE o.type = 'agency'
        AND o.agency_id = client_agency_connections.agency_id
    )
  )
  WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- client_agency_connections: DELETE — client self or client org member
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Client deletes own connections" ON public.client_agency_connections;

CREATE POLICY "Client org deletes connection requests"
  ON public.client_agency_connections FOR DELETE TO authenticated
  USING (
    client_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.organization_members m1
      JOIN public.organization_members m2 ON m1.organization_id = m2.organization_id
      JOIN public.organizations o ON o.id = m1.organization_id AND o.type = 'client'
      WHERE m1.user_id = auth.uid()
        AND m2.user_id = client_agency_connections.client_id
    )
  );
