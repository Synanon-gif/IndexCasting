-- =============================================================================
-- 20261022_guest_links_agency_share_purpose.sql
--
-- Agency-to-Agency Roster Share — additive `guest_links` extension.
--
-- Adds:
--   * `purpose`             — 'client_share' (default, existing rows) | 'agency_share'
--   * `target_agency_id`    — recipient agency UUID (resolved from email at create time)
--   * `target_agency_email` — recipient email (raw input, case-insensitive resolution)
--
-- Adds RLS policy `guest_links_select_target_agency` allowing recipient-agency
-- members to SELECT their incoming share rows. Existing SELECT/INSERT/UPDATE/
-- DELETE policies for the sender agency remain unchanged. Default 'client_share'
-- preserves the entire existing client/guest package flow.
--
-- Idempotent. Single migration; not deployed via root supabase/*.sql.
-- =============================================================================

ALTER TABLE public.guest_links
  ADD COLUMN IF NOT EXISTS purpose text NOT NULL DEFAULT 'client_share',
  ADD COLUMN IF NOT EXISTS target_agency_id uuid NULL REFERENCES public.agencies(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS target_agency_email text NULL;

ALTER TABLE public.guest_links
  DROP CONSTRAINT IF EXISTS guest_links_purpose_check;

ALTER TABLE public.guest_links
  ADD CONSTRAINT guest_links_purpose_check
  CHECK (purpose IN ('client_share', 'agency_share'));

-- Helpful index for inbox queries.
CREATE INDEX IF NOT EXISTS idx_guest_links_target_agency
  ON public.guest_links(target_agency_id)
  WHERE purpose = 'agency_share' AND deleted_at IS NULL;

-- New SELECT policy for agency recipients. Pure SELECT (no FOR ALL),
-- references organizations + organization_members only — no profiles/models
-- back-reference, so no recursion risk on the profiles→models RLS path.
DROP POLICY IF EXISTS "guest_links_select_target_agency" ON public.guest_links;

CREATE POLICY "guest_links_select_target_agency"
  ON public.guest_links FOR SELECT TO authenticated
  USING (
    purpose = 'agency_share'
    AND target_agency_id IS NOT NULL
    AND deleted_at IS NULL
    AND EXISTS (
      SELECT 1
      FROM public.organizations o
      JOIN public.organization_members om ON om.organization_id = o.id
      WHERE o.agency_id = guest_links.target_agency_id
        AND o.type = 'agency'::organization_type
        AND om.user_id = auth.uid()
    )
  );

COMMENT ON COLUMN public.guest_links.purpose IS
  'Share purpose: client_share (default — external/client package) or agency_share (Agency-to-Agency roster transfer, 20261022).';

COMMENT ON COLUMN public.guest_links.target_agency_id IS
  '20261022: resolved recipient agency for purpose=agency_share. NULL when not yet onboarded.';

COMMENT ON COLUMN public.guest_links.target_agency_email IS
  '20261022: raw recipient email for purpose=agency_share (case-insensitive resolution at create time).';

DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'guest_links' AND column_name = 'purpose'
  ), 'FAIL: guest_links.purpose missing after 20261022 migration';

  ASSERT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'guest_links' AND column_name = 'target_agency_id'
  ), 'FAIL: guest_links.target_agency_id missing after 20261022 migration';

  ASSERT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'guest_links'
      AND policyname = 'guest_links_select_target_agency'
  ), 'FAIL: guest_links_select_target_agency policy missing after 20261022 migration';
END;
$$;

NOTIFY pgrst, 'reload schema';
