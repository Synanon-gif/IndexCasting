-- =============================================================================
-- Client discovery consistency
--
-- Problem: "Clients can read represented visible models" only checks
--   profiles.role = 'client'.
-- If a user is invited as an employee/member of a CLIENT organization
--   (organizations.type = 'client'), but their profiles.role is not yet 'client',
--   they cannot discover models.
--
-- Fix: extend the SELECT policy to ALSO allow any member of a client-type
--   organization — mirrors the pattern used for agency members.
--
-- No changes to INSERT/UPDATE/DELETE (those remain agency-scoped).
-- =============================================================================

ALTER TABLE public.models ENABLE ROW LEVEL SECURITY;

-- Drop the current client-facing SELECT policy (any name variant applied so far)
DROP POLICY IF EXISTS "Clients can read represented visible models" ON public.models;

-- Recreate: allow access if EITHER
--   (a) the caller has profiles.role = 'client'  — legacy / direct client accounts
--   (b) the caller is a member of any client organization  — invited employees/owners
-- In both cases, the model must be visible (commercial or fashion) and have a
-- discoverable territory or real location.
CREATE POLICY "Clients can read represented visible models"
  ON public.models FOR SELECT
  TO authenticated
  USING (
    (
      -- (a) direct client role on profile
      EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid()
          AND p.role = 'client'
      )
      -- (b) member of a client-type organization (owner, employee, booker)
      OR EXISTS (
        SELECT 1
        FROM public.organizations       o
        JOIN public.organization_members om ON om.organization_id = o.id
        WHERE o.type       = 'client'
          AND om.user_id   = auth.uid()
      )
      -- (c) org owner_id (in case they have no organization_members row)
      OR EXISTS (
        SELECT 1
        FROM public.organizations o
        WHERE o.type     = 'client'
          AND o.owner_id = auth.uid()
      )
    )
    AND (models.is_visible_commercial = true OR models.is_visible_fashion = true)
    AND (
      (models.country_code IS NOT NULL)
      OR EXISTS (
        SELECT 1
        FROM public.model_agency_territories mat
        WHERE mat.model_id = models.id
      )
    )
  );

-- =============================================================================
-- model_photos: same consistency fix for client SELECT access
-- (Clients need to see photos in detail views; this is additive to existing
--  policies and doesn't change agency policies.)
-- =============================================================================
DROP POLICY IF EXISTS "Clients see visible model photos" ON public.model_photos;

CREATE POLICY "Clients see visible model photos"
  ON public.model_photos FOR SELECT
  TO authenticated
  USING (
    is_visible_to_clients = true
    AND (
      EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid()
          AND p.role = 'client'
      )
      OR EXISTS (
        SELECT 1
        FROM public.organizations       o
        JOIN public.organization_members om ON om.organization_id = o.id
        WHERE o.type     = 'client'
          AND om.user_id = auth.uid()
      )
      OR EXISTS (
        SELECT 1 FROM public.organizations o
        WHERE o.type = 'client' AND o.owner_id = auth.uid()
      )
    )
  );

-- =============================================================================
-- model_agency_territories: clients can read territories to resolve discovery
-- (The "Authenticated users can read territories" policy already covers this,
--  but leaving this comment for documentation clarity.)
-- =============================================================================
-- No change needed — existing permissive SELECT policy covers all authenticated users.

-- =============================================================================
-- client_filter_preset: ensure save/load RPCs work for org-member clients
-- (The RPCs use auth.uid() directly, so they work for any authenticated user
--  regardless of org membership. No RLS change needed on profiles for this.)
-- =============================================================================
