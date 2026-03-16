-- =============================================================================
-- Phase 9: KI-Matching, Daily Boost, Gamification
-- Voraussetzung: pgvector Extension muss in Supabase aktiviert sein.
-- Dashboard → Database → Extensions → vector aktivieren.
-- Im Supabase SQL Editor ausführen.
-- =============================================================================

-- pgvector Extension (muss aktiviert sein)
CREATE EXTENSION IF NOT EXISTS vector;

-- Vektor-Einbettungen für Models (Attribute als Embedding für Similarity-Search)
CREATE TABLE IF NOT EXISTS public.model_embeddings (
  model_id UUID PRIMARY KEY REFERENCES public.models(id) ON DELETE CASCADE,
  embedding vector(384),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Vektor-Einbettungen für Client-Präferenzen
CREATE TABLE IF NOT EXISTS public.client_preference_embeddings (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  embedding vector(384),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Similarity-Search Funktion
CREATE OR REPLACE FUNCTION public.match_models(
  query_embedding vector(384),
  match_threshold FLOAT DEFAULT 0.7,
  match_count INT DEFAULT 10
)
RETURNS TABLE (
  model_id UUID,
  similarity FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    me.model_id,
    1 - (me.embedding <=> query_embedding) AS similarity
  FROM public.model_embeddings me
  WHERE 1 - (me.embedding <=> query_embedding) > match_threshold
  ORDER BY me.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- Daily Boost
CREATE TABLE IF NOT EXISTS public.boosts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id UUID NOT NULL REFERENCES public.models(id) ON DELETE CASCADE,
  boosted_at DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (model_id, boosted_at)
);

CREATE INDEX IF NOT EXISTS idx_boosts_date ON public.boosts(boosted_at);

-- Gamification: Badges
CREATE TABLE IF NOT EXISTS public.badges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  badge_type TEXT NOT NULL,
  earned_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_badges_user ON public.badges(user_id);

-- Gamification: Streaks
CREATE TABLE IF NOT EXISTS public.streaks (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  current_streak INTEGER NOT NULL DEFAULT 0,
  longest_streak INTEGER NOT NULL DEFAULT 0,
  last_active_date DATE NOT NULL DEFAULT CURRENT_DATE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE public.model_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_preference_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.boosts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.badges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.streaks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Embeddings readable by authenticated"
  ON public.model_embeddings FOR SELECT TO authenticated USING (true);
CREATE POLICY "Client embeddings owner only"
  ON public.client_preference_embeddings FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "Boosts readable by all"
  ON public.boosts FOR SELECT TO authenticated USING (true);
CREATE POLICY "Model owner can boost"
  ON public.boosts FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Badges readable by all"
  ON public.badges FOR SELECT TO authenticated USING (true);
CREATE POLICY "System manages badges"
  ON public.badges FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Streaks owner only"
  ON public.streaks FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
