-- =============================================================================
-- Input Validation Constraints
--
-- Adds backend enforcement for:
--   1. Text length limits on chat message tables (prevents oversized payloads
--      regardless of frontend validation).
--   2. file_type whitelists on all tables that store file MIME types (prevents
--      unexpected types reaching storage via direct API calls).
--
-- These constraints run at the PostgreSQL level — they are enforced even when
-- requests bypass the frontend entirely (direct API / Postman / scripts).
-- RLS policies remain unchanged.
--
-- Run after all existing migrations.
-- =============================================================================


-- ─── 1. messages (Org ↔ Org B2B chat) ────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_schema = 'public'
      AND constraint_name = 'messages_text_max_length'
  ) THEN
    ALTER TABLE public.messages
      ADD CONSTRAINT messages_text_max_length
        CHECK (text IS NULL OR char_length(text) <= 4000);
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_schema = 'public'
      AND constraint_name = 'messages_file_type_whitelist'
  ) THEN
    ALTER TABLE public.messages
      ADD CONSTRAINT messages_file_type_whitelist
        CHECK (
          file_type IS NULL OR
          file_type IN (
            'image/jpeg',
            'image/png',
            'image/webp',
            'application/pdf'
          )
        );
  END IF;
END;
$$;


-- ─── 2. recruiting_chat_messages (Agency ↔ Model chat) ───────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_schema = 'public'
      AND constraint_name = 'recruiting_chat_messages_text_max_length'
  ) THEN
    ALTER TABLE public.recruiting_chat_messages
      ADD CONSTRAINT recruiting_chat_messages_text_max_length
        CHECK (char_length(text) <= 4000);
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_schema = 'public'
      AND constraint_name = 'recruiting_chat_messages_file_type_whitelist'
  ) THEN
    ALTER TABLE public.recruiting_chat_messages
      ADD CONSTRAINT recruiting_chat_messages_file_type_whitelist
        CHECK (
          file_type IS NULL OR
          file_type IN (
            'image/jpeg',
            'image/png',
            'image/webp',
            'application/pdf'
          )
        );
  END IF;
END;
$$;


-- ─── 3. guest_chat_messages (Guest link chat) ────────────────────────────────

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'guest_chat_messages'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.check_constraints
      WHERE constraint_schema = 'public'
        AND constraint_name = 'guest_chat_messages_text_max_length'
    ) THEN
      ALTER TABLE public.guest_chat_messages
        ADD CONSTRAINT guest_chat_messages_text_max_length
          CHECK (char_length(text) <= 4000);
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM information_schema.check_constraints
      WHERE constraint_schema = 'public'
        AND constraint_name = 'guest_chat_messages_file_type_whitelist'
    ) THEN
      ALTER TABLE public.guest_chat_messages
        ADD CONSTRAINT guest_chat_messages_file_type_whitelist
          CHECK (
            file_type IS NULL OR
            file_type IN (
              'image/jpeg',
              'image/png',
              'image/webp',
              'application/pdf'
            )
          );
    END IF;
  END IF;
END;
$$;


-- ─── 4. model_photos (image type safety) ─────────────────────────────────────

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'model_photos'
      AND column_name  = 'content_type'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.check_constraints
      WHERE constraint_schema = 'public'
        AND constraint_name = 'model_photos_content_type_whitelist'
    ) THEN
      ALTER TABLE public.model_photos
        ADD CONSTRAINT model_photos_content_type_whitelist
          CHECK (
            content_type IS NULL OR
            content_type IN (
              'image/jpeg',
              'image/png',
              'image/webp'
            )
          );
    END IF;
  END IF;
END;
$$;


-- ─── 5. Verification: show applied constraints ────────────────────────────────

SELECT
  tc.table_name,
  tc.constraint_name,
  cc.check_clause
FROM information_schema.table_constraints tc
JOIN information_schema.check_constraints cc
  ON tc.constraint_name = cc.constraint_name
 AND tc.constraint_schema = cc.constraint_schema
WHERE tc.constraint_schema = 'public'
  AND tc.constraint_name IN (
    'messages_text_max_length',
    'messages_file_type_whitelist',
    'recruiting_chat_messages_text_max_length',
    'recruiting_chat_messages_file_type_whitelist',
    'guest_chat_messages_text_max_length',
    'guest_chat_messages_file_type_whitelist',
    'model_photos_content_type_whitelist'
  )
ORDER BY tc.table_name, tc.constraint_name;
