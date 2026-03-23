-- =============================================================================
-- Messenger: allow message_type = 'booking'
-- =============================================================================

ALTER TABLE public.messages
  DROP CONSTRAINT IF EXISTS messages_message_type_check;

ALTER TABLE public.messages
  ADD CONSTRAINT messages_message_type_check
  CHECK (message_type IN ('text', 'link', 'package', 'model', 'booking'));

