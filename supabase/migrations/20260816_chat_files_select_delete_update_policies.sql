-- =============================================================================
-- chat-files bucket — SELECT + UPDATE + DELETE policies
--
-- SELECT: migrated from root-SQL (migration_prelaunch_security_fixes.sql /
-- migration_security_verifications_storage_2026_04.sql) into supabase/migrations/.
-- Ensures new deployments and staging environments have proper scoped access.
--
-- Path conventions:
--   chat/{conversation_id}/{filename}        — conversations.participant_ids
--   recruiting/{thread_id}/{filename}        — recruiting thread membership
--   options/{option_request_id}/{filename}   — option_request_visible_to_me()
--
-- UPDATE: owner-only (the uploader may update metadata on their own files)
-- DELETE: owner-only (the uploader may remove their own files)
-- =============================================================================

-- ── SELECT ──────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS chat_files_recruiting_select ON storage.objects;
DROP POLICY IF EXISTS chat_files_select_scoped ON storage.objects;

CREATE POLICY chat_files_select_scoped
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'chat-files'
    AND (
      owner = auth.uid()

      -- chat/ files: conversation participant
      OR (
        (storage.foldername(objects.name))[1] = 'chat'
        AND EXISTS (
          SELECT 1 FROM public.conversations c
          WHERE c.id::text = (storage.foldername(objects.name))[2]
            AND auth.uid()::text = ANY(c.participant_ids::text[])
        )
      )

      -- recruiting/ files: agency org member OR applicant OR legacy booker
      OR (
        (storage.foldername(objects.name))[1] = 'recruiting'
        AND (
          EXISTS (
            SELECT 1 FROM public.recruiting_chat_threads rt
            JOIN public.organizations o ON o.agency_id = rt.agency_id
            JOIN public.organization_members om ON om.organization_id = o.id
            WHERE rt.id::text = (storage.foldername(objects.name))[2]
              AND om.user_id = auth.uid()
          )
          OR EXISTS (
            SELECT 1 FROM public.recruiting_chat_threads rt
            JOIN public.model_applications app ON app.id = rt.application_id
            WHERE rt.id::text = (storage.foldername(objects.name))[2]
              AND app.applicant_user_id = auth.uid()
          )
        )
      )

      -- options/ files: option request participant
      OR (
        (storage.foldername(objects.name))[1] = 'options'
        AND EXISTS (
          SELECT 1 FROM public.option_requests orq
          WHERE orq.id::text = (storage.foldername(objects.name))[2]
            AND public.option_request_visible_to_me(orq.id)
        )
      )
    )
  );

-- ── UPDATE ──────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS chat_files_update_owner ON storage.objects;

CREATE POLICY chat_files_update_owner
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'chat-files'
    AND owner = auth.uid()
  );

-- ── DELETE ──────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS chat_files_delete_owner ON storage.objects;

CREATE POLICY chat_files_delete_owner
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'chat-files'
    AND owner = auth.uid()
  );
