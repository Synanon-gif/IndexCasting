-- Migration: Add file_url and file_type to recruiting_chat_messages
-- Enables photo + file attachments in Agency↔Model recruiting/booking chats.
-- The messages table (B2B org chat) already has these columns from phase5.

-- 1. Add attachment columns to recruiting_chat_messages
ALTER TABLE public.recruiting_chat_messages
  ADD COLUMN IF NOT EXISTS file_url  TEXT    DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS file_type TEXT    DEFAULT NULL;

-- 2. Ensure the chat-files storage bucket exists (idempotent)
--    In Supabase Dashboard: Storage → Buckets → "chat-files" must be PRIVATE.
--    Run this only if the bucket does not already exist.
-- INSERT INTO storage.buckets (id, name, public)
-- VALUES ('chat-files', 'chat-files', false)
-- ON CONFLICT (id) DO NOTHING;

-- 3. RLS policy: allow authenticated users to upload to recruiting/ sub-path
--    (agency bookers + models uploading attachments)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename  = 'objects'
      AND policyname = 'chat_files_recruiting_upload'
  ) THEN
    CREATE POLICY chat_files_recruiting_upload
      ON storage.objects
      FOR INSERT
      TO authenticated
      WITH CHECK (
        bucket_id = 'chat-files'
        AND (storage.foldername(name))[1] = 'recruiting'
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename  = 'objects'
      AND policyname = 'chat_files_recruiting_select'
  ) THEN
    CREATE POLICY chat_files_recruiting_select
      ON storage.objects
      FOR SELECT
      TO authenticated
      USING (
        bucket_id = 'chat-files'
        AND (storage.foldername(name))[1] IN ('chat', 'recruiting', 'options')
      );
  END IF;
END $$;

-- 4. Ensure chat/ upload policy covers authenticated users (B2B messages)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename  = 'objects'
      AND policyname = 'chat_files_chat_upload'
  ) THEN
    CREATE POLICY chat_files_chat_upload
      ON storage.objects
      FOR INSERT
      TO authenticated
      WITH CHECK (
        bucket_id = 'chat-files'
        AND (storage.foldername(name))[1] = 'chat'
      );
  END IF;
END $$;
