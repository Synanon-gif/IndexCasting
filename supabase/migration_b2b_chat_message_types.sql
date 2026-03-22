-- B2B messenger: structured message payloads (no friendship layer — app uses org-scoped chats only).
-- Run in Supabase SQL Editor after existing messenger migrations.

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS message_type TEXT NOT NULL DEFAULT 'text';

ALTER TABLE public.messages
  DROP CONSTRAINT IF EXISTS messages_message_type_check;

ALTER TABLE public.messages
  ADD CONSTRAINT messages_message_type_check
  CHECK (message_type IN ('text', 'link', 'package', 'model'));

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS metadata JSONB;

COMMENT ON COLUMN public.messages.message_type IS 'text | link | package | model — B2B chat payload kind.';
COMMENT ON COLUMN public.messages.metadata IS 'Optional JSON: package_id, guest_link, model_id, url, etc.';
