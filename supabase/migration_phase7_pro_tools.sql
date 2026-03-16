-- =============================================================================
-- Phase 7: Professionelle Tools
-- Kalender, Buchungen/Provisionen, Dokumenten-Safe Storage Bucket
-- Im Supabase SQL Editor ausführen.
-- =============================================================================

-- Model-Kalender: Verfügbarkeit und geblockte Tage
CREATE TABLE IF NOT EXISTS public.calendar_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id UUID NOT NULL REFERENCES public.models(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'blocked', 'booked', 'tentative')),
  booking_id UUID,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (model_id, date)
);

CREATE INDEX IF NOT EXISTS idx_calendar_model ON public.calendar_entries(model_id);
CREATE INDEX IF NOT EXISTS idx_calendar_date ON public.calendar_entries(date);

-- Buchungen (Provisionsabrechnung)
CREATE TABLE IF NOT EXISTS public.bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id UUID NOT NULL REFERENCES public.models(id) ON DELETE CASCADE,
  agency_id UUID NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  client_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  project_id UUID REFERENCES public.client_projects(id) ON DELETE SET NULL,
  booking_date DATE NOT NULL,
  end_date DATE,
  fee_total NUMERIC(10,2),
  commission_rate NUMERIC(5,2) DEFAULT 20.00,
  commission_amount NUMERIC(10,2),
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'completed', 'cancelled', 'invoiced')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bookings_model ON public.bookings(model_id);
CREATE INDEX IF NOT EXISTS idx_bookings_agency ON public.bookings(agency_id);

-- RLS
ALTER TABLE public.calendar_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read calendar entries"
  ON public.calendar_entries FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can manage calendar entries"
  ON public.calendar_entries FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated can read bookings"
  ON public.bookings FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can manage bookings"
  ON public.bookings FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Triggers
CREATE TRIGGER bookings_updated_at
  BEFORE UPDATE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
