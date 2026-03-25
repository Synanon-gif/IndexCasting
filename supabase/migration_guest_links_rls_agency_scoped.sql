-- =============================================================================
-- guest_links RLS: agency-scoped write access
--
-- Problem: The existing "Agency members can manage guest links" policy uses
--   USING (true) WITH CHECK (true) for ALL authenticated users.
--   This means ANY logged-in user (including clients, models, etc.) can
--   create, read, update and delete ANY agency's guest links — a critical
--   security vulnerability.
--
-- Fix:
--   1. Drop the overly permissive ALL-authenticated policy.
--   2. Create a precise INSERT/UPDATE/DELETE policy that restricts write access
--      to members of the agency organization that owns the guest link.
--   3. Keep the existing SELECT policies (anon + authenticated) unchanged —
--      clients need SELECT to load packages sent in B2B chat.
--
-- After applying this migration, the effective permissions are:
--   anon          → SELECT active guest links  (guest external flow)
--   authenticated → SELECT active guest links  (client in-app package flow)
--   authenticated (agency member) → ALL on own agency's links
-- =============================================================================

-- Drop the overly broad policy
DROP POLICY IF EXISTS "Agency members can manage guest links" ON public.guest_links;

-- ---------------------------------------------------------------------------
-- Agency members can INSERT new guest links for their own agency
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Agency members can insert own guest links" ON public.guest_links;
CREATE POLICY "Agency members can insert own guest links"
  ON public.guest_links FOR INSERT TO authenticated
  WITH CHECK (
    agency_id IN (
      -- via organization_members row
      SELECT o.id
      FROM public.organizations o
      JOIN public.organization_members om ON om.organization_id = o.id
      WHERE o.type = 'agency'
        AND om.user_id = auth.uid()
      UNION
      -- via owner_id (owner may not always have an org-member row)
      SELECT o.id
      FROM public.organizations o
      WHERE o.type = 'agency'
        AND o.owner_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- Agency members can UPDATE (e.g. deactivate) their own agency's guest links
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Agency members can update own guest links" ON public.guest_links;
CREATE POLICY "Agency members can update own guest links"
  ON public.guest_links FOR UPDATE TO authenticated
  USING (
    agency_id IN (
      SELECT o.id
      FROM public.organizations o
      JOIN public.organization_members om ON om.organization_id = o.id
      WHERE o.type = 'agency'
        AND om.user_id = auth.uid()
      UNION
      SELECT o.id
      FROM public.organizations o
      WHERE o.type = 'agency'
        AND o.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    agency_id IN (
      SELECT o.id
      FROM public.organizations o
      JOIN public.organization_members om ON om.organization_id = o.id
      WHERE o.type = 'agency'
        AND om.user_id = auth.uid()
      UNION
      SELECT o.id
      FROM public.organizations o
      WHERE o.type = 'agency'
        AND o.owner_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- Agency members can DELETE their own agency's guest links
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Agency members can delete own guest links" ON public.guest_links;
CREATE POLICY "Agency members can delete own guest links"
  ON public.guest_links FOR DELETE TO authenticated
  USING (
    agency_id IN (
      SELECT o.id
      FROM public.organizations o
      JOIN public.organization_members om ON om.organization_id = o.id
      WHERE o.type = 'agency'
        AND om.user_id = auth.uid()
      UNION
      SELECT o.id
      FROM public.organizations o
      WHERE o.type = 'agency'
        AND o.owner_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- SELECT policies remain as-is:
--   "Anon can read guest links"           → anon, is_active = true
--   "Authenticated can read active guest links" → authenticated, is_active = true
-- Both are required:
--   - anon:          external guest users browsing the shared package URL
--   - authenticated: registered clients opening a package sent in B2B chat
-- ---------------------------------------------------------------------------
-- (No DROP/CREATE needed — these policies are correct and already present.)
