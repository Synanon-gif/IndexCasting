-- =============================================================================
-- Fix: documentspictures_select_scoped — pass full object name to
-- can_view_model_photo_storage (not just folder segment)
--
-- Root cause: can_view_model_photo_storage(p_object_name) expects a 3-part
-- bucket-relative path (e.g. 'model-photos/{model_id}/file.jpg') and checks
-- array_length >= 3.  The live policy was passing (storage.foldername(name))[2]
-- which yields only the model_id (1 part) → always returns false →
-- ALL model photos invisible to ALL users (agency, client, model).
--
-- Fix: pass `name` (the full bucket-relative path) instead of the folder
-- segment. This matches the function signature deployed by migration
-- 20260501_can_view_model_photo_storage_client_row_alignment.sql.
--
-- The model-applications branch and fallback owner-check are preserved.
-- =============================================================================

DROP POLICY IF EXISTS documentspictures_select_scoped ON storage.objects;

CREATE POLICY documentspictures_select_scoped
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'documentspictures'
    AND (
      -- model-photos / model-private-photos: full authorization via SECDEF helper
      (
        (storage.foldername(name))[1] IN ('model-photos', 'model-private-photos')
        AND public.can_view_model_photo_storage(name)
      )
      OR
      -- model-applications: owner or any agency org member (global recruiting pool)
      (
        (storage.foldername(name))[1] = 'model-applications'
        AND (owner = auth.uid() OR public.is_any_agency_org_member())
      )
      OR
      -- everything else: owner only
      (
        (storage.foldername(name))[1] NOT IN (
          'model-photos', 'model-private-photos', 'model-applications'
        )
        AND owner = auth.uid()
      )
    )
  );
