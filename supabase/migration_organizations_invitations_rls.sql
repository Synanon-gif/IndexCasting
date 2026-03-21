-- =============================================================================
-- Organizations, Einladungen, Mitgliedschaften + verschärfte RLS für option_requests
-- Ausführen im Supabase SQL Editor (nach bestehenden Migrationen).
-- =============================================================================

-- --- Enums ------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.organization_type AS ENUM ('agency', 'client');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.org_member_role AS ENUM ('owner', 'booker', 'employee');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.invitation_org_role AS ENUM ('booker', 'employee');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.invitation_status AS ENUM ('pending', 'accepted');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- --- organizations ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  type public.organization_type NOT NULL,
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  agency_id UUID REFERENCES public.agencies(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS organizations_one_agency
  ON public.organizations (agency_id)
  WHERE agency_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS organizations_one_client_owner
  ON public.organizations (owner_id)
  WHERE type = 'client';

-- --- organization_members ---------------------------------------------------
CREATE TABLE IF NOT EXISTS public.organization_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  role public.org_member_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, organization_id)
);

CREATE INDEX IF NOT EXISTS idx_org_members_org ON public.organization_members (organization_id);
CREATE INDEX IF NOT EXISTS idx_org_members_user ON public.organization_members (user_id);

-- --- invitations ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  role public.invitation_org_role NOT NULL,
  invited_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  status public.invitation_status NOT NULL DEFAULT 'pending',
  token TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_invitations_org ON public.invitations (organization_id);
CREATE INDEX IF NOT EXISTS idx_invitations_email_lower ON public.invitations (lower(trim(email)));

-- --- option_requests / Kalender / Recruiting (Spalten) ------------------------
ALTER TABLE public.option_requests
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL;
ALTER TABLE public.option_requests
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.option_requests
  ADD COLUMN IF NOT EXISTS agency_assignee_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.user_calendar_events
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL;
ALTER TABLE public.user_calendar_events
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.recruiting_chat_threads
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL;
ALTER TABLE public.recruiting_chat_threads
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- --- Hilfsfunktion: Option-Request für aktuellen User sichtbar? ------------
CREATE OR REPLACE FUNCTION public.option_request_visible_to_me(p_request_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.option_requests oq
    WHERE oq.id = p_request_id
      AND (
        EXISTS (
          SELECT 1 FROM public.models mo
          WHERE mo.id = oq.model_id AND mo.user_id = auth.uid()
        )
        OR (
          oq.organization_id IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM public.organizations oc
            JOIN public.organization_members mc ON mc.organization_id = oc.id
            WHERE oc.id = oq.organization_id
              AND oc.type = 'client'
              AND mc.user_id = auth.uid()
          )
        )
        OR (
          oq.organization_id IS NULL
          AND oq.client_id = auth.uid()
        )
        OR EXISTS (
          SELECT 1
          FROM public.organizations oa
          JOIN public.organization_members ma ON ma.organization_id = oa.id
          WHERE oa.agency_id = oq.agency_id
            AND oa.type = 'agency'
            AND ma.user_id = auth.uid()
            AND (
              ma.role = 'owner'
              OR (
                ma.role = 'booker'
                AND (
                  oq.agency_assignee_user_id IS NULL
                  OR oq.agency_assignee_user_id = auth.uid()
                )
              )
            )
        )
      )
  );
$$;

REVOKE ALL ON FUNCTION public.option_request_visible_to_me(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.option_request_visible_to_me(uuid) TO authenticated;

-- --- RPC: Einladung ansehen (öffentlich, nur Metadaten) ---------------------
CREATE OR REPLACE FUNCTION public.get_invitation_preview(p_token text)
RETURNS TABLE(org_name text, org_type text, invite_role text, expires_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT o.name, o.type::text, i.role::text, i.expires_at
  FROM public.invitations i
  JOIN public.organizations o ON o.id = i.organization_id
  WHERE i.token = p_token
    AND i.status = 'pending'
    AND i.expires_at > now()
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_invitation_preview(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_invitation_preview(text) TO anon, authenticated;

-- --- RPC: Agentur-Organisation anlegen (nur Master-E-Mail = Agentur-E-Mail) -
CREATE OR REPLACE FUNCTION public.ensure_agency_organization(p_agency_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  oid uuid;
  aname text;
  aemail text;
  pemail text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  SELECT p.email INTO pemail FROM public.profiles p WHERE p.id = auth.uid();
  SELECT a.name, a.email INTO aname, aemail FROM public.agencies a WHERE a.id = p_agency_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'agency not found';
  END IF;
  IF lower(trim(COALESCE(pemail, ''))) IS DISTINCT FROM lower(trim(COALESCE(aemail, ''))) THEN
    RAISE EXCEPTION 'only agency master (email match) can bootstrap organization';
  END IF;
  IF (SELECT role FROM public.profiles WHERE id = auth.uid()) IS DISTINCT FROM 'agent' THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT o.id INTO oid FROM public.organizations o WHERE o.agency_id = p_agency_id LIMIT 1;
  IF oid IS NOT NULL THEN
    RETURN oid;
  END IF;

  INSERT INTO public.organizations (name, type, owner_id, agency_id)
  VALUES (COALESCE(NULLIF(trim(aname), ''), 'Agency'), 'agency', auth.uid(), p_agency_id)
  RETURNING id INTO oid;

  INSERT INTO public.organization_members (user_id, organization_id, role)
  VALUES (auth.uid(), oid, 'owner');

  RETURN oid;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_agency_organization(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_agency_organization(uuid) TO authenticated;

-- --- RPC: Client-Organisation (ein Owner pro Client-Account) ----------------
CREATE OR REPLACE FUNCTION public.ensure_client_organization()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  oid uuid;
  oname text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF (SELECT role FROM public.profiles WHERE id = auth.uid()) IS DISTINCT FROM 'client' THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT o.id INTO oid
  FROM public.organizations o
  WHERE o.owner_id = auth.uid() AND o.type = 'client'
  LIMIT 1;
  IF oid IS NOT NULL THEN
    RETURN oid;
  END IF;

  SELECT COALESCE(NULLIF(trim(company_name), ''), NULLIF(trim(display_name), ''), 'Organization')
  INTO oname
  FROM public.profiles
  WHERE id = auth.uid();

  INSERT INTO public.organizations (name, type, owner_id, agency_id)
  VALUES (oname, 'client', auth.uid(), NULL)
  RETURNING id INTO oid;

  INSERT INTO public.organization_members (user_id, organization_id, role)
  VALUES (auth.uid(), oid, 'owner');

  RETURN oid;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_client_organization() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_client_organization() TO authenticated;

-- --- RPC: Einladung annehmen ------------------------------------------------
CREATE OR REPLACE FUNCTION public.accept_organization_invitation(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inv public.invitations%ROWTYPE;
  org public.organizations%ROWTYPE;
  uemail text;
  prole public.user_role;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  SELECT email INTO uemail FROM auth.users WHERE id = auth.uid();
  SELECT * INTO inv
  FROM public.invitations
  WHERE token = p_token AND status = 'pending' AND expires_at > now();

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

  SELECT role INTO prole FROM public.profiles WHERE id = auth.uid();
  IF org.type = 'agency' AND inv.role = 'booker' AND prole IS DISTINCT FROM 'agent' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'wrong_profile_role', 'expected', 'agent');
  END IF;
  IF org.type = 'client' AND inv.role = 'employee' AND prole IS DISTINCT FROM 'client' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'wrong_profile_role', 'expected', 'client');
  END IF;

  INSERT INTO public.organization_members (user_id, organization_id, role)
  VALUES (
    auth.uid(),
    inv.organization_id,
    CASE inv.role
      WHEN 'booker' THEN 'booker'::public.org_member_role
      WHEN 'employee' THEN 'employee'::public.org_member_role
      ELSE 'employee'::public.org_member_role
    END
  )
  ON CONFLICT (user_id, organization_id) DO NOTHING;

  UPDATE public.invitations
  SET status = 'accepted'
  WHERE id = inv.id;

  RETURN jsonb_build_object('ok', true, 'organization_id', inv.organization_id);
END;
$$;

REVOKE ALL ON FUNCTION public.accept_organization_invitation(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_organization_invitation(text) TO authenticated;

-- --- RPC: Rolle in Agentur-Org (für UI-Filter) -------------------------------
CREATE OR REPLACE FUNCTION public.get_my_agency_member_role(p_agency_id uuid)
RETURNS TABLE(member_role text, organization_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT m.role::text, m.organization_id
  FROM public.organization_members m
  JOIN public.organizations o ON o.id = m.organization_id
  WHERE m.user_id = auth.uid()
    AND o.agency_id = p_agency_id
    AND o.type = 'agency'
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_my_agency_member_role(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_agency_member_role(uuid) TO authenticated;

-- --- RLS organizations --------------------------------------------------------
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS organizations_select_member ON public.organizations;
CREATE POLICY organizations_select_member
  ON public.organizations FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.organization_members m
      WHERE m.organization_id = organizations.id AND m.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS organizations_no_insert ON public.organizations;
CREATE POLICY organizations_no_insert
  ON public.organizations FOR INSERT
  TO authenticated
  WITH CHECK (false);

-- --- RLS organization_members -----------------------------------------------
ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_members_select ON public.organization_members;
CREATE POLICY org_members_select
  ON public.organization_members FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.organization_members mo
      WHERE mo.organization_id = organization_members.organization_id
        AND mo.user_id = auth.uid()
        AND mo.role = 'owner'
    )
  );

DROP POLICY IF EXISTS org_members_no_mutate ON public.organization_members;
CREATE POLICY org_members_no_mutate
  ON public.organization_members FOR INSERT
  TO authenticated
  WITH CHECK (false);

DROP POLICY IF EXISTS org_members_no_update ON public.organization_members;
CREATE POLICY org_members_no_update
  ON public.organization_members FOR UPDATE
  TO authenticated
  USING (false);

DROP POLICY IF EXISTS org_members_no_delete ON public.organization_members;
CREATE POLICY org_members_no_delete
  ON public.organization_members FOR DELETE
  TO authenticated
  USING (false);

-- --- RLS invitations --------------------------------------------------------
ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS invitations_select_owner ON public.invitations;
CREATE POLICY invitations_select_owner
  ON public.invitations FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.organization_members m
      WHERE m.organization_id = invitations.organization_id
        AND m.user_id = auth.uid()
        AND m.role = 'owner'
    )
  );

DROP POLICY IF EXISTS invitations_insert_owner ON public.invitations;
CREATE POLICY invitations_insert_owner
  ON public.invitations FOR INSERT
  TO authenticated
  WITH CHECK (
    invited_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.organization_members m
      WHERE m.organization_id = organization_id
        AND m.user_id = auth.uid()
        AND m.role = 'owner'
    )
  );

DROP POLICY IF EXISTS invitations_no_update ON public.invitations;
CREATE POLICY invitations_no_update
  ON public.invitations FOR UPDATE
  TO authenticated
  USING (false);

-- --- option_requests: Policies ersetzen -------------------------------------
DROP POLICY IF EXISTS "Client can read own option requests" ON public.option_requests;
DROP POLICY IF EXISTS "Agency can read option requests for their agency" ON public.option_requests;
DROP POLICY IF EXISTS "Client can create option request" ON public.option_requests;
DROP POLICY IF EXISTS "Client or agency can update option request" ON public.option_requests;

CREATE POLICY option_requests_select_scoped
  ON public.option_requests FOR SELECT
  TO authenticated
  USING (public.option_request_visible_to_me(id));

CREATE POLICY option_requests_insert_client
  ON public.option_requests FOR INSERT
  TO authenticated
  WITH CHECK (
    client_id = auth.uid()
    AND (
      organization_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.organization_members m
        WHERE m.organization_id = organization_id AND m.user_id = auth.uid()
      )
    )
  );

CREATE POLICY option_requests_update_participant
  ON public.option_requests FOR UPDATE
  TO authenticated
  USING (public.option_request_visible_to_me(id))
  WITH CHECK (public.option_request_visible_to_me(id));

-- --- option_request_messages ------------------------------------------------
DROP POLICY IF EXISTS "Participants can read option messages" ON public.option_request_messages;
DROP POLICY IF EXISTS "Participants can insert option messages" ON public.option_request_messages;

CREATE POLICY option_messages_select_if_request_visible
  ON public.option_request_messages FOR SELECT
  TO authenticated
  USING (public.option_request_visible_to_me(option_request_id));

CREATE POLICY option_messages_insert_if_request_visible
  ON public.option_request_messages FOR INSERT
  TO authenticated
  WITH CHECK (public.option_request_visible_to_me(option_request_id));

-- =============================================================================
-- Hinweis: Nach Deploy Frontend organization_id + created_by bei neuen Requests setzen.
-- Alte Zeilen (organization_id NULL): Client sieht weiter über client_id = auth.uid();
-- Agentur: Owner sieht alle einer Agentur; Booker nur mit passendem created_by (oder Migration).
-- =============================================================================
