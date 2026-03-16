-- =============================================================================
-- Phase 13: Location, Currency, Model Photos, Calendar Jobs
-- =============================================================================

-- 1. Model current location (city only, GDPR compliant)
ALTER TABLE public.models ADD COLUMN IF NOT EXISTS current_location TEXT;
CREATE INDEX IF NOT EXISTS idx_models_current_location ON public.models(current_location);

-- 2. Currency field on option_requests
ALTER TABLE public.option_requests ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'EUR';

-- 3. Model photos management table
CREATE TABLE IF NOT EXISTS public.model_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id UUID NOT NULL REFERENCES public.models(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  visible BOOLEAN DEFAULT true,
  source TEXT DEFAULT 'manual',
  api_external_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_model_photos_model ON public.model_photos(model_id);
CREATE INDEX IF NOT EXISTS idx_model_photos_order ON public.model_photos(model_id, sort_order);

-- 4. Model API connections (Mediaslide/Netwalk per model)
ALTER TABLE public.models ADD COLUMN IF NOT EXISTS polas_source TEXT DEFAULT 'manual';
ALTER TABLE public.models ADD COLUMN IF NOT EXISTS show_polas_on_profile BOOLEAN DEFAULT true;
ALTER TABLE public.models ADD COLUMN IF NOT EXISTS mediaslide_model_id TEXT;
ALTER TABLE public.models ADD COLUMN IF NOT EXISTS netwalk_model_id TEXT;

-- 5. Agency API credentials
ALTER TABLE public.agencies ADD COLUMN IF NOT EXISTS mediaslide_api_key TEXT;
ALTER TABLE public.agencies ADD COLUMN IF NOT EXISTS netwalk_api_key TEXT;
ALTER TABLE public.agencies ADD COLUMN IF NOT EXISTS mediaslide_connected BOOLEAN DEFAULT false;
ALTER TABLE public.agencies ADD COLUMN IF NOT EXISTS netwalk_connected BOOLEAN DEFAULT false;

-- 6. Calendar entries: distinguish agency-editable bookings from personal entries
ALTER TABLE public.calendar_entries ADD COLUMN IF NOT EXISTS created_by_agency BOOLEAN DEFAULT false;
ALTER TABLE public.calendar_entries ADD COLUMN IF NOT EXISTS option_request_id UUID;
ALTER TABLE public.calendar_entries ADD COLUMN IF NOT EXISTS client_name TEXT;
ALTER TABLE public.calendar_entries ADD COLUMN IF NOT EXISTS booking_details JSONB DEFAULT '{}';

-- =============================================================================
-- RLS for model_photos
-- =============================================================================
ALTER TABLE public.model_photos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view visible photos" ON public.model_photos;
CREATE POLICY "Anyone can view visible photos"
  ON public.model_photos FOR SELECT
  USING (visible = true);

DROP POLICY IF EXISTS "Agency can manage model photos" ON public.model_photos;
CREATE POLICY "Agency can manage model photos"
  ON public.model_photos FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.models m
      JOIN public.agencies a ON a.id = m.agency_id
      JOIN public.profiles p ON p.id = auth.uid()
      WHERE m.id = model_photos.model_id
      AND p.role = 'agent'
      AND a.email = p.email
    )
  );

-- =============================================================================
-- Update calendar RLS: Agency can edit booking entries
-- =============================================================================
DROP POLICY IF EXISTS "Agency can edit booking calendar entries" ON public.calendar_entries;
CREATE POLICY "Agency can edit booking calendar entries"
  ON public.calendar_entries FOR UPDATE
  USING (
    created_by_agency = true
    AND EXISTS (
      SELECT 1 FROM public.models m
      JOIN public.agencies a ON a.id = m.agency_id
      JOIN public.profiles p ON p.id = auth.uid()
      WHERE m.id = calendar_entries.model_id
      AND p.role = 'agent'
      AND a.email = p.email
    )
  );
