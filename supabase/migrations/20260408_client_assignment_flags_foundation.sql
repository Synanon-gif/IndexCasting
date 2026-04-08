-- Client Assignment / Flag Foundation (agency-internal ownership metadata only).
-- Invariant: this table MUST NOT be used as an authorization layer.

CREATE TABLE IF NOT EXISTS public.client_assignment_flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  label text NOT NULL,
  color text NOT NULL,
  assigned_member_user_id uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  is_archived boolean NOT NULL DEFAULT false,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT client_assignment_flags_unique_pair UNIQUE (agency_organization_id, client_organization_id),
  CONSTRAINT client_assignment_flags_label_len CHECK (char_length(trim(label)) BETWEEN 1 AND 40),
  CONSTRAINT client_assignment_flags_color_allowed CHECK (
    color IN ('gray', 'blue', 'green', 'amber', 'purple', 'red')
  ),
  CONSTRAINT client_assignment_flags_not_self_pair CHECK (agency_organization_id <> client_organization_id)
);

CREATE INDEX IF NOT EXISTS idx_client_assignment_flags_agency_org
  ON public.client_assignment_flags (agency_organization_id);
CREATE INDEX IF NOT EXISTS idx_client_assignment_flags_client_org
  ON public.client_assignment_flags (client_organization_id);
CREATE INDEX IF NOT EXISTS idx_client_assignment_flags_assignee
  ON public.client_assignment_flags (assigned_member_user_id);

ALTER TABLE public.client_assignment_flags ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.caller_is_member_of_agency_org(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_members om
    JOIN public.organizations o ON o.id = om.organization_id
    WHERE om.user_id = auth.uid()
      AND om.organization_id = p_org_id
      AND o.type = 'agency'
  );
$$;

-- Agency members (same organization) can read assignment metadata.
DROP POLICY IF EXISTS caf_select_for_agency_members ON public.client_assignment_flags;
CREATE POLICY caf_select_for_agency_members
ON public.client_assignment_flags
FOR SELECT
TO authenticated
USING (
  public.is_current_user_admin()
  OR public.caller_is_member_of_agency_org(agency_organization_id)
);

-- Only agency members can insert metadata for their own agency org.
DROP POLICY IF EXISTS caf_insert_for_agency_members ON public.client_assignment_flags;
CREATE POLICY caf_insert_for_agency_members
ON public.client_assignment_flags
FOR INSERT
TO authenticated
WITH CHECK (
  public.is_current_user_admin()
  OR (
    public.caller_is_member_of_agency_org(agency_organization_id)
    AND created_by = auth.uid()
  )
);

-- Only agency members can update metadata for their own agency org.
DROP POLICY IF EXISTS caf_update_for_agency_members ON public.client_assignment_flags;
CREATE POLICY caf_update_for_agency_members
ON public.client_assignment_flags
FOR UPDATE
TO authenticated
USING (
  public.is_current_user_admin()
  OR public.caller_is_member_of_agency_org(agency_organization_id)
)
WITH CHECK (
  public.is_current_user_admin()
  OR public.caller_is_member_of_agency_org(agency_organization_id)
);

-- Only agency members can delete metadata for their own agency org.
DROP POLICY IF EXISTS caf_delete_for_agency_members ON public.client_assignment_flags;
CREATE POLICY caf_delete_for_agency_members
ON public.client_assignment_flags
FOR DELETE
TO authenticated
USING (
  public.is_current_user_admin()
  OR public.caller_is_member_of_agency_org(agency_organization_id)
);

CREATE OR REPLACE FUNCTION public.touch_client_assignment_flags_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_client_assignment_flags_updated_at ON public.client_assignment_flags;
CREATE TRIGGER trg_touch_client_assignment_flags_updated_at
BEFORE UPDATE ON public.client_assignment_flags
FOR EACH ROW
EXECUTE FUNCTION public.touch_client_assignment_flags_updated_at();
