-- Einmal ausführen: Fügt die Spalte "code" für Abwärtskompatibilität hinzu (a1, a2, a3).

ALTER TABLE public.agencies
  ADD COLUMN IF NOT EXISTS code TEXT UNIQUE;

-- Bestehende Zeilen aktualisieren (falls du die Seed-Agenturen schon eingefügt hast)
UPDATE public.agencies SET code = 'a1' WHERE id = 'a1000000-0000-4000-8000-000000000001'::uuid;
UPDATE public.agencies SET code = 'a2' WHERE id = 'a1000000-0000-4000-8000-000000000002'::uuid;
UPDATE public.agencies SET code = 'a3' WHERE id = 'a1000000-0000-4000-8000-000000000003'::uuid;
