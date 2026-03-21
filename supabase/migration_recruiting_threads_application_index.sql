-- Speed up lookups by application (start chat, orphan healing, agency queues at scale)
CREATE INDEX IF NOT EXISTS idx_recruiting_threads_application_id
  ON public.recruiting_chat_threads (application_id, created_at DESC);
