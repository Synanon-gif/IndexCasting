-- Manuelle Kalender-Ereignisse für Kunden und Agenturen (zusätzlich zu Option/Job/Casting)
CREATE TABLE IF NOT EXISTS public.user_calendar_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL,
  owner_type TEXT NOT NULL CHECK (owner_type IN ('client', 'agency')),
  date DATE NOT NULL,
  start_time TEXT,
  end_time TEXT,
  title TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#1565C0',
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_calendar_events_owner
  ON public.user_calendar_events(owner_id, owner_type);
CREATE INDEX IF NOT EXISTS idx_user_calendar_events_date
  ON public.user_calendar_events(date);

-- Trigger: updated_at bei UPDATE setzen
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS user_calendar_events_updated_at ON public.user_calendar_events;
CREATE TRIGGER user_calendar_events_updated_at
  BEFORE UPDATE ON public.user_calendar_events
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.user_calendar_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own calendar events" ON public.user_calendar_events;
CREATE POLICY "Users can manage own calendar events"
  ON public.user_calendar_events FOR ALL
  TO authenticated
  USING (
    (owner_type = 'client' AND owner_id = auth.uid())
    OR
    (owner_type = 'agency' AND owner_id IN (SELECT a.id FROM public.agencies a JOIN public.profiles p ON p.id = auth.uid() WHERE p.role = 'agent' AND a.email = p.email))
  )
  WITH CHECK (
    (owner_type = 'client' AND owner_id = auth.uid())
    OR
    (owner_type = 'agency' AND owner_id IN (SELECT a.id FROM public.agencies a JOIN public.profiles p ON p.id = auth.uid() WHERE p.role = 'agent' AND a.email = p.email))
  );
