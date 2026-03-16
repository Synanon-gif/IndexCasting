-- =============================================================================
-- Phase 14: Options vs Jobs, Price Negotiation, Territories, Polaroids
-- =============================================================================

-- 1) Erweiterung option_requests: Price-Negotiation + Status-Kette + Typ (option/casting)

ALTER TABLE public.option_requests
  ADD COLUMN IF NOT EXISTS agency_counter_price NUMERIC;

ALTER TABLE public.option_requests
  ADD COLUMN IF NOT EXISTS client_price_status TEXT DEFAULT 'pending';

ALTER TABLE public.option_requests
  ADD COLUMN IF NOT EXISTS final_status TEXT DEFAULT 'option_pending';

DO $$
BEGIN
  ALTER TABLE public.option_requests
    ADD COLUMN request_type TEXT DEFAULT 'option';
EXCEPTION
  WHEN duplicate_column THEN NULL;
END $$;

ALTER TABLE public.option_requests
  DROP CONSTRAINT IF EXISTS option_requests_client_price_status_check;
ALTER TABLE public.option_requests
  ADD CONSTRAINT option_requests_client_price_status_check
  CHECK (client_price_status IN ('pending','accepted','rejected'))
  NOT VALID;

ALTER TABLE public.option_requests
  DROP CONSTRAINT IF EXISTS option_requests_final_status_check;
ALTER TABLE public.option_requests
  ADD CONSTRAINT option_requests_final_status_check
  CHECK (final_status IN ('option_pending','option_confirmed','job_confirmed'))
  NOT VALID;

ALTER TABLE public.option_requests
  DROP CONSTRAINT IF EXISTS option_requests_request_type_check;
ALTER TABLE public.option_requests
  ADD CONSTRAINT option_requests_request_type_check
  CHECK (request_type IN ('option','casting'))
  NOT VALID;

-- 2) model_photos: Portfolio vs Polaroids

DO $$
BEGIN
  ALTER TABLE public.model_photos
    ADD COLUMN photo_type TEXT DEFAULT 'portfolio';
EXCEPTION
  WHEN duplicate_column THEN NULL;
END $$;

ALTER TABLE public.model_photos
  DROP CONSTRAINT IF EXISTS model_photos_type_check;
ALTER TABLE public.model_photos
  ADD CONSTRAINT model_photos_type_check
  CHECK (photo_type IN ('portfolio','polaroid'))
  NOT VALID;

-- 3) Territories: Welche Agentur vertritt welches Model in welchem Land?

CREATE TABLE IF NOT EXISTS public.model_agency_territories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id UUID NOT NULL REFERENCES public.models(id) ON DELETE CASCADE,
  agency_id UUID NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  country_code TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (model_id, country_code)
);

CREATE INDEX IF NOT EXISTS idx_model_agency_territories_model
  ON public.model_agency_territories(model_id);

CREATE INDEX IF NOT EXISTS idx_model_agency_territories_agency
  ON public.model_agency_territories(agency_id);

-- RLS: Agentur darf nur ihre eigenen Territories pflegen

ALTER TABLE public.model_agency_territories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Agencies can view their territories" ON public.model_agency_territories;
CREATE POLICY "Agencies can view their territories"
  ON public.model_agency_territories
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.agencies a
      JOIN public.profiles p ON p.id = auth.uid()
      WHERE a.id = model_agency_territories.agency_id
      AND p.role = 'agent'
      AND a.email = p.email
    )
  );

DROP POLICY IF EXISTS "Agencies can manage their territories" ON public.model_agency_territories;
CREATE POLICY "Agencies can manage their territories"
  ON public.model_agency_territories
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.agencies a
      JOIN public.profiles p ON p.id = auth.uid()
      WHERE a.id = model_agency_territories.agency_id
      AND p.role = 'agent'
      AND a.email = p.email
    )
  );

