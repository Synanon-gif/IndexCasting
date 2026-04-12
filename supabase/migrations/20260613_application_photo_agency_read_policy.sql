-- Migration: Ensure agencies can read application photos from storage
-- Purpose: Application images in documentspictures/model-applications/* must be
-- readable by agencies for the Recruiting view. The bucket is private, so a
-- storage policy must allow authenticated users to read these paths.
-- This migration is idempotent.

-- Policy: allow authenticated users to read model-applications/* from documentspictures
-- (Application photos are visible to all agencies per product rule — global recruiting pool)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'documentspictures_application_photos_read'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY "documentspictures_application_photos_read"
        ON storage.objects FOR SELECT TO authenticated
        USING (
          bucket_id = 'documentspictures'
          AND (storage.foldername(name))[1] = 'model-applications'
        )
    $policy$;
  END IF;
END $$;
