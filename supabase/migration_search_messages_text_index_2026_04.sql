-- =============================================================================
-- GIN Trigram Index on messages.text
--
-- Problem: search_global RPC uses EXISTS (SELECT 1 FROM messages WHERE text ILIKE v_pattern)
-- which causes a full-table scan on every conversation search query.
--
-- Fix: Add a GIN trigram index on messages.text so ILIKE patterns can use the index.
-- pg_trgm is already enabled by migration_search_global_rpc.sql — safe to re-run.
--
-- Idempotent: CREATE EXTENSION IF NOT EXISTS / CREATE INDEX IF NOT EXISTS.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_messages_text_trgm
  ON public.messages USING gin (text gin_trgm_ops);
