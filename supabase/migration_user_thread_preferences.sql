-- =============================================================================
-- User Thread Preferences
--
-- Stores per-user preferences for messaging threads (archive status, etc.).
-- Cross-device: replaces the localStorage-only ci_archived_threads approach.
--
-- Design decisions:
--   • user_id + thread_id unique: one preference row per user per thread.
--   • org_id stored for audit and multi-tenant filtering.
--   • Soft preference: rows never deleted, only toggled. Archived = TRUE.
--   • RLS: users can only read/write their own rows.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.user_thread_preferences (
  id         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id     UUID         NOT NULL,
  thread_id  TEXT         NOT NULL,
  is_archived BOOLEAN     NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, thread_id)
);

ALTER TABLE public.user_thread_preferences ENABLE ROW LEVEL SECURITY;

-- Users manage only their own rows
CREATE POLICY "user_thread_preferences_own"
  ON public.user_thread_preferences
  FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Index for fast per-org queries
CREATE INDEX IF NOT EXISTS idx_user_thread_pref_user_org
  ON public.user_thread_preferences (user_id, org_id);
