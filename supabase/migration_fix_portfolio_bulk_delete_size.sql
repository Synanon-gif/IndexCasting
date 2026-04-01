-- =============================================================================
-- Fix: Portfolio Bulk-Delete Size Source
--
-- BUG: get_model_portfolio_file_paths reads size_bytes exclusively from
--      storage.objects metadata. If a file no longer exists in storage
--      (e.g. already cleaned up externally), COALESCE returns 0, so
--      deleteModelPortfolioFiles computes totalBytes = 0 and never decrements
--      the storage counter — leaving it permanently inflated.
--
-- FIX: Use model_photos.file_size_bytes (stored reliably at upload time per
--      Phase 28b BUG 1 fix) as the primary size source.
--      Falls back to storage.objects metadata for photos uploaded before
--      Phase 28b (where file_size_bytes = 0).
--
-- Run after Phase 28b (migration_storage_size_hardening.sql).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_model_portfolio_file_paths(p_model_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage
AS $$
DECLARE
  v_org_id    UUID;
  v_agency_id UUID;
  v_result    JSON;
BEGIN
  SELECT om.organization_id INTO v_org_id
  FROM   public.organization_members om
  JOIN   public.organizations o ON o.id = om.organization_id
  WHERE  om.user_id = auth.uid()
    AND  o.type     = 'agency'
  LIMIT 1;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'get_model_portfolio_file_paths: unauthorized';
  END IF;

  -- Resolve the agencies.id linked to the caller's organization.
  SELECT o.agency_id INTO v_agency_id
  FROM   public.organizations o
  WHERE  o.id = v_org_id
  LIMIT 1;

  -- Ownership check: model must belong to the caller's agency.
  IF v_agency_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.models m
    WHERE  m.id        = p_model_id
      AND  m.agency_id = v_agency_id
  ) THEN
    RAISE EXCEPTION 'get_model_portfolio_file_paths: model does not belong to your organization';
  END IF;

  SELECT json_agg(
    json_build_object(
      'photo_id',   mp.id,
      'url',        mp.url,
      'bucket',     CASE
                      WHEN mp.url LIKE 'supabase-private://documents/%' THEN 'documents'
                      ELSE 'documentspictures'
                    END,
      'path',       CASE
                      WHEN mp.url LIKE 'supabase-private://documents/%'
                        THEN replace(mp.url, 'supabase-private://documents/', '')
                      WHEN mp.url LIKE '%/storage/v1/object/public/documentspictures/%'
                        THEN split_part(mp.url, '/storage/v1/object/public/documentspictures/', 2)
                      ELSE NULL
                    END,
      -- FIX: prefer model_photos.file_size_bytes (recorded at upload time per Phase 28b BUG 1
      -- fix). Fall back to storage.objects metadata for pre-Phase-28b rows where the column
      -- value is still 0. COALESCE(NULLIF(..., 0), ...) treats 0 as "not recorded yet".
      'size_bytes', CASE
                      WHEN mp.url LIKE 'supabase-private://documents/%'
                        THEN COALESCE(
                          NULLIF(mp.file_size_bytes, 0),
                          (SELECT (so.metadata->>'size')::bigint
                           FROM   storage.objects so
                           WHERE  so.bucket_id = 'documents'
                             AND  so.name = replace(mp.url, 'supabase-private://documents/', '')
                           LIMIT 1),
                          0
                        )
                      WHEN mp.url LIKE '%/storage/v1/object/public/documentspictures/%'
                        THEN COALESCE(
                          NULLIF(mp.file_size_bytes, 0),
                          (SELECT (so.metadata->>'size')::bigint
                           FROM   storage.objects so
                           WHERE  so.bucket_id = 'documentspictures'
                             AND  so.name = split_part(mp.url, '/storage/v1/object/public/documentspictures/', 2)
                           LIMIT 1),
                          0
                        )
                      ELSE 0
                    END
    )
  ) INTO v_result
  FROM   public.model_photos mp
  WHERE  mp.model_id = p_model_id
    AND  (
      mp.url LIKE 'supabase-private://documents/%'
      OR mp.url LIKE '%/storage/v1/object/public/documentspictures/%'
      OR mp.url LIKE '%/storage/v1/object/sign/%'
    );

  RETURN COALESCE(v_result, '[]'::json);
END;
$$;

REVOKE ALL    ON FUNCTION public.get_model_portfolio_file_paths(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_model_portfolio_file_paths(UUID) TO authenticated;
