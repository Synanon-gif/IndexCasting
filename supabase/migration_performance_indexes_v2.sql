-- ============================================================
-- Performance Indexes v2
-- Drei fehlende Indizes für Hot-Path-Queries bei 100k Usern.
-- Alle mit IF NOT EXISTS – sicher idempotent wiederholbar.
-- ============================================================

-- 1. profiles(created_at DESC)
--    adminSupabase.ts lädt profiles ORDER BY created_at → ohne Index: Seq-Scan + Sort.
CREATE INDEX IF NOT EXISTS idx_profiles_created_at
  ON public.profiles(created_at DESC);

-- 2. messages(conversation_id, created_at DESC) – Composite
--    getMessages() filtert auf conversation_id und sortiert nach created_at DESC.
--    Der bestehende idx_messages_conversation deckt nur den Filter-Part;
--    dieser Composite-Index deckt Filter + Sort in einem Schritt ab.
CREATE INDEX IF NOT EXISTS idx_messages_conversation_created
  ON public.messages(conversation_id, created_at DESC);

-- 3. option_request_messages(option_request_id, created_at DESC) – Composite
--    Gleicher Ladepattern: chronologische Nachrichten pro Option-Request.
CREATE INDEX IF NOT EXISTS idx_option_messages_request_created
  ON public.option_request_messages(option_request_id, created_at DESC);
