-- Recruiting-Chat-Threads: agency_id speichern, damit Agentur und Model immer den Chat zuordnen können.
-- Voraussetzung: Tabelle public.recruiting_chat_threads und public.agencies existieren.
-- Ohne diese Spalte schlägt public.agency_start_recruiting_chat mit 42703 fehl.
ALTER TABLE public.recruiting_chat_threads
  ADD COLUMN IF NOT EXISTS agency_id UUID REFERENCES public.agencies(id);

COMMENT ON COLUMN public.recruiting_chat_threads.agency_id IS 'Agentur, die den Chat gestartet hat / die Bewerbung angenommen hat.';

-- Bestehende Threads: agency_id aus angenommener Bewerbung setzen
UPDATE public.recruiting_chat_threads t
SET agency_id = a.accepted_by_agency_id
FROM public.model_applications a
WHERE t.application_id = a.id AND a.accepted_by_agency_id IS NOT NULL AND t.agency_id IS NULL;
