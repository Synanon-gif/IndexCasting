-- ============================================================
-- Push Tokens
-- Speichert Expo-Push-Tokens pro User + Platform für native
-- Push-Notifications (iOS APNs / Android FCM via Expo Push API).
-- DSGVO: Token gilt als personenbezogenes Datum → RLS + soft-delete.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.push_tokens (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token        text NOT NULL,
  platform     text NOT NULL CHECK (platform IN ('ios', 'android', 'web')),
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  -- Ein Device-Token darf nur einmal pro User vorkommen
  UNIQUE (user_id, token)
);

-- Performance: Lookup "alle aktiven Tokens eines Users" (Edge Function)
CREATE INDEX IF NOT EXISTS idx_push_tokens_user_id
  ON public.push_tokens(user_id)
  WHERE is_active = true;

-- Performance: Lookup nach Token (Dedup-Check bei Registrierung)
CREATE INDEX IF NOT EXISTS idx_push_tokens_token
  ON public.push_tokens(token);

-- ── Row Level Security ────────────────────────────────────────────────────────

ALTER TABLE public.push_tokens ENABLE ROW LEVEL SECURITY;

-- User darf nur eigene Tokens lesen
CREATE POLICY "push_tokens: select own"
  ON public.push_tokens FOR SELECT
  USING (auth.uid() = user_id);

-- User darf eigene Tokens registrieren
CREATE POLICY "push_tokens: insert own"
  ON public.push_tokens FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- User darf eigene Tokens deaktivieren (soft delete via is_active = false)
CREATE POLICY "push_tokens: update own"
  ON public.push_tokens FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Hard delete: nur eigene Tokens (z.B. beim Account-Logout)
CREATE POLICY "push_tokens: delete own"
  ON public.push_tokens FOR DELETE
  USING (auth.uid() = user_id);

-- updated_at automatisch setzen
CREATE OR REPLACE FUNCTION public.set_push_tokens_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER push_tokens_updated_at
  BEFORE UPDATE ON public.push_tokens
  FOR EACH ROW EXECUTE FUNCTION public.set_push_tokens_updated_at();

-- ── DSGVO: Right to Erasure ───────────────────────────────────────────────────
-- Tokens werden bei user-Deletion durch ON DELETE CASCADE automatisch gelöscht.
-- Zusätzlich: delete-user Edge Function (supabase/functions/delete-user)
-- ruft bereits alle verknüpften Daten ab — kein separater Schritt nötig.
