-- =============================================================================
-- documents bucket — Storage RLS policies (SELECT, INSERT, UPDATE, DELETE)
--
-- The documents bucket stores:
--   documents/{userId}/…        — user documents (contracts, invoices, IDs)
--   verifications/{userId}/…    — identity verification uploads
--   model-private-photos/{modelId}/… — private model photos (supabase-private://)
--
-- Previously these policies existed only in root-SQL files outside migrations/,
-- violating the MIGRATIONS-DEPLOYMENT invariant. This migration canonicalises
-- them so that new deployments and staging environments are protected.
--
-- Guards:
--   - Owner (uploader) always retains access to own files
--   - documents/ and verifications/: user_id path segment = auth.uid()
--     OR agency org member of the model whose user_id matches
--   - model-private-photos/: agency member of the model OR model itself
--   - Admin: via is_current_user_admin()
-- =============================================================================

-- ── SELECT ──────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS documents_select_scoped ON storage.objects;

CREATE POLICY documents_select_scoped
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'documents'
    AND (
      owner = auth.uid()

      OR public.is_current_user_admin()

      -- documents/{userId}/… or verifications/{userId}/…
      OR (
        (storage.foldername(objects.name))[1] IN ('documents', 'verifications')
        AND (
          (storage.foldername(objects.name))[2] = auth.uid()::text
          OR EXISTS (
            SELECT 1
            FROM public.models m
            JOIN public.organizations o ON o.agency_id = m.agency_id
            JOIN public.organization_members om ON om.organization_id = o.id
            WHERE m.user_id::text = (storage.foldername(objects.name))[2]
              AND om.user_id = auth.uid()
              AND o.type = 'agency'
          )
        )
      )

      -- model-private-photos/{modelId}/…
      OR (
        (storage.foldername(objects.name))[1] = 'model-private-photos'
        AND (
          EXISTS (
            SELECT 1
            FROM public.models m
            WHERE m.id::text = (storage.foldername(objects.name))[2]
              AND m.user_id = auth.uid()
          )
          OR EXISTS (
            SELECT 1
            FROM public.models m
            JOIN public.organizations o ON o.agency_id = m.agency_id
            JOIN public.organization_members om ON om.organization_id = o.id
            WHERE m.id::text = (storage.foldername(objects.name))[2]
              AND om.user_id = auth.uid()
              AND o.type = 'agency'
          )
        )
      )
    )
  );

-- ── INSERT ──────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS documents_insert_scoped ON storage.objects;

CREATE POLICY documents_insert_scoped
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'documents'
    AND (
      -- documents/ and verifications/: only to own user folder
      (
        (storage.foldername(objects.name))[1] IN ('documents', 'verifications')
        AND (storage.foldername(objects.name))[2] = auth.uid()::text
      )
      -- model-private-photos/: agency member of the model OR model itself
      OR (
        (storage.foldername(objects.name))[1] = 'model-private-photos'
        AND (
          EXISTS (
            SELECT 1
            FROM public.models m
            WHERE m.id::text = (storage.foldername(objects.name))[2]
              AND m.user_id = auth.uid()
          )
          OR EXISTS (
            SELECT 1
            FROM public.models m
            JOIN public.organizations o ON o.agency_id = m.agency_id
            JOIN public.organization_members om ON om.organization_id = o.id
            WHERE m.id::text = (storage.foldername(objects.name))[2]
              AND om.user_id = auth.uid()
              AND o.type = 'agency'
          )
        )
      )
    )
  );

-- ── UPDATE ──────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS documents_update_scoped ON storage.objects;

CREATE POLICY documents_update_scoped
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'documents'
    AND (
      owner = auth.uid()
      OR public.is_current_user_admin()
    )
  );

-- ── DELETE ──────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS documents_delete_scoped ON storage.objects;

CREATE POLICY documents_delete_scoped
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'documents'
    AND (
      owner = auth.uid()
      OR public.is_current_user_admin()
    )
  );
