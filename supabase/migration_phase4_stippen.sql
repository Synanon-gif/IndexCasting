-- =============================================================================
-- Phase 4: Stippen-Logik, Geo-Filter, erweiterte Model-Spalten
-- Im Supabase SQL Editor ausführen.
-- =============================================================================

-- Geo-Location Spalte für Models (lat/lng)
ALTER TABLE public.models
  ADD COLUMN IF NOT EXISTS current_lat DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS current_lng DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS eye_color_enum TEXT;

-- Stippen-Tabelle (User „stippt" ein Model – gegenseitiges Stippen = Match)
CREATE TABLE IF NOT EXISTS public.stippen (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  to_model_id UUID NOT NULL REFERENCES public.models(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (from_user_id, to_model_id)
);

CREATE INDEX IF NOT EXISTS idx_stippen_from ON public.stippen(from_user_id);
CREATE INDEX IF NOT EXISTS idx_stippen_to ON public.stippen(to_model_id);

-- Traction-Score View (Anzahl Stippen pro Model)
CREATE OR REPLACE VIEW public.model_traction AS
  SELECT
    m.id AS model_id,
    m.name,
    m.agency_id,
    COUNT(s.id)::INTEGER AS stippen_count
  FROM public.models m
  LEFT JOIN public.stippen s ON s.to_model_id = m.id
  GROUP BY m.id, m.name, m.agency_id;

-- RLS
ALTER TABLE public.stippen ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read stippen"
  ON public.stippen FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users can manage own stippen"
  ON public.stippen FOR INSERT TO authenticated WITH CHECK (from_user_id = auth.uid());
CREATE POLICY "Users can delete own stippen"
  ON public.stippen FOR DELETE TO authenticated USING (from_user_id = auth.uid());
