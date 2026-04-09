-- ============================================================================
-- Organization Logos — Storage Bucket + Policies
-- 2026-05-15
--
-- Creates a dedicated storage bucket for organization logos and
-- enforces owner-only write access via a SECURITY DEFINER helper.
--
-- Bucket: organization-logos (public read for authenticated users)
-- Path:   {organization_id}/{timestamp}-logo.{ext}
--
-- Access model:
--   - Any authenticated user: SELECT (URL only discoverable via RLS-protected
--     organization_profiles.logo_url; org UUID in path is non-guessable)
--   - Org owner only: INSERT / UPDATE / DELETE (via can_manage_org_logo())
--
-- RLS safety checklist:
--   [x] SECURITY DEFINER with SET row_security TO off
--   [x] Guard 1: auth.uid() IS NULL → false
--   [x] Guard 2: is_org_owner(p_org_id) — checks organization_members + organizations
--   [x] No direct profiles/models JOIN in storage policy (no Risiko 13)
--   [x] No FOR ALL on tables in profiles→models SELECT path
--   [x] org_id extracted from storage path via foldername(), cast to uuid
-- ============================================================================


-- ── Bucket ────────────────────────────────────────────────────────────────────

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'organization-logos',
  'organization-logos',
  true,                 -- public: URL is only surfaced via RLS-protected logo_url field
  5242880,              -- 5 MB limit
  ARRAY[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'image/heif'
  ]
)
ON CONFLICT (id) DO UPDATE
  SET file_size_limit    = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;


-- ── SECURITY DEFINER Helper ───────────────────────────────────────────────────

-- Returns true only when the calling user is the owner of the given organisation.
-- Called from storage policies; row_security=off avoids RLS recursion in PG15+.
CREATE OR REPLACE FUNCTION public.can_manage_org_logo(p_org_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
BEGIN
  -- Guard 1: must be authenticated
  IF auth.uid() IS NULL THEN
    RETURN false;
  END IF;

  -- Guard 2: caller must be the owner of this specific organisation
  RETURN public.is_org_owner(p_org_id);
END;
$$;

COMMENT ON FUNCTION public.can_manage_org_logo(uuid) IS
  'SECURITY DEFINER helper for storage.objects policies on the organization-logos bucket. '
  'Returns true only when the authenticated caller is the owner of p_org_id.';


-- ── Storage Policies on storage.objects ──────────────────────────────────────

-- Path structure inside the bucket: {org_id}/{timestamp}-logo.{ext}
-- (storage.foldername(name))[1] → org_id segment

-- SELECT: any authenticated user may read
--   (the logo URL is only obtainable via the RLS-protected organization_profiles table)
DROP POLICY IF EXISTS "org_logos_select" ON storage.objects;
CREATE POLICY "org_logos_select"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (bucket_id = 'organization-logos');

-- INSERT: owner only
DROP POLICY IF EXISTS "org_logos_insert" ON storage.objects;
CREATE POLICY "org_logos_insert"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'organization-logos'
    AND public.can_manage_org_logo(((storage.foldername(name))[1])::uuid)
  );

-- UPDATE: owner only (used by upsert=true replacement path)
DROP POLICY IF EXISTS "org_logos_update" ON storage.objects;
CREATE POLICY "org_logos_update"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'organization-logos'
    AND public.can_manage_org_logo(((storage.foldername(name))[1])::uuid)
  )
  WITH CHECK (
    bucket_id = 'organization-logos'
    AND public.can_manage_org_logo(((storage.foldername(name))[1])::uuid)
  );

-- DELETE: owner only (cleans up old logo files after replacement)
DROP POLICY IF EXISTS "org_logos_delete" ON storage.objects;
CREATE POLICY "org_logos_delete"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'organization-logos'
    AND public.can_manage_org_logo(((storage.foldername(name))[1])::uuid)
  );


-- ── Post-deploy verification (run manually to confirm) ────────────────────────
--
-- SELECT id, name, public FROM storage.buckets WHERE id = 'organization-logos';
-- -- Expected: 1 row
--
-- SELECT policyname, cmd FROM pg_policies
--   WHERE tablename = 'objects' AND policyname LIKE 'org_logos_%';
-- -- Expected: 4 rows (select, insert, update, delete)
--
-- SELECT proname FROM pg_proc
--   WHERE pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
--     AND proname = 'can_manage_org_logo';
-- -- Expected: 1 row
