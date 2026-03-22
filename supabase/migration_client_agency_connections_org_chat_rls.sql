-- Client ↔ Agency connection requests: org metadata, optional messenger link, tighter RLS.
-- Run in Supabase SQL Editor after organizations + messenger (conversations) migrations.

-- --- Enum: allow rejected status --------------------------------------------
DO $$ BEGIN
  ALTER TYPE public.connection_status ADD VALUE 'rejected';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- --- Columns ----------------------------------------------------------------
ALTER TABLE public.client_agency_connections
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.client_agency_connections
  ADD COLUMN IF NOT EXISTS from_organization_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL;

ALTER TABLE public.client_agency_connections
  ADD COLUMN IF NOT EXISTS to_organization_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL;

ALTER TABLE public.client_agency_connections
  ADD COLUMN IF NOT EXISTS conversation_id UUID REFERENCES public.conversations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_cac_from_org ON public.client_agency_connections (from_organization_id);
CREATE INDEX IF NOT EXISTS idx_cac_to_org ON public.client_agency_connections (to_organization_id);
CREATE INDEX IF NOT EXISTS idx_cac_conversation ON public.client_agency_connections (conversation_id);

-- --- RLS: replace overly broad agency SELECT --------------------------------
DROP POLICY IF EXISTS "Agencies can read connections where they are agency" ON public.client_agency_connections;

-- Agency org members (owner + bookers) can read rows for their agency
CREATE POLICY "Agency org members read client_agency_connections"
  ON public.client_agency_connections FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.organizations o
      JOIN public.organization_members m ON m.organization_id = o.id AND m.user_id = auth.uid()
      WHERE o.type = 'agency'
        AND o.agency_id = client_agency_connections.agency_id
    )
  );

-- Client: self OR same client organization as the connection’s client user
DROP POLICY IF EXISTS "Clients can read own connections" ON public.client_agency_connections;

CREATE POLICY "Client users read own org connections"
  ON public.client_agency_connections FOR SELECT TO authenticated
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

-- Client may delete own outgoing / pending rows
DROP POLICY IF EXISTS "Client deletes own connections" ON public.client_agency_connections;
CREATE POLICY "Client deletes own connections"
  ON public.client_agency_connections FOR DELETE TO authenticated
  USING (client_id = auth.uid());

-- Agency org members may delete (reject) incoming requests
DROP POLICY IF EXISTS "Agency org members delete connection requests" ON public.client_agency_connections;
CREATE POLICY "Agency org members delete connection requests"
  ON public.client_agency_connections FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.organizations o
      JOIN public.organization_members m ON m.organization_id = o.id AND m.user_id = auth.uid()
      WHERE o.type = 'agency'
        AND o.agency_id = client_agency_connections.agency_id
    )
  );
