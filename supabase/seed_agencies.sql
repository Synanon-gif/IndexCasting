-- Einmal im Supabase SQL Editor ausführen, falls die Tabelle public.agencies leer ist.
-- Fügt die drei Demo-Agenturen ein (IDs fest für stabile Referenzen).

-- Spalte code muss existieren (sonst zuerst migration_agencies_code.sql ausführen)
INSERT INTO public.agencies (id, name, city, focus, email, code)
VALUES
  ('a1000000-0000-4000-8000-000000000001'::uuid, 'Studio Marais', 'Paris', 'High-Fashion', 'contact@studiomarais.com', 'a1'),
  ('a1000000-0000-4000-8000-000000000002'::uuid, 'Canal Casting', 'Paris', 'Commercial', 'hello@canalcasting.com', 'a2'),
  ('a1000000-0000-4000-8000-000000000003'::uuid, 'Linea Milano', 'Milan', 'High-Fashion', 'info@lineamilano.com', 'a3')
ON CONFLICT (id) DO NOTHING;
