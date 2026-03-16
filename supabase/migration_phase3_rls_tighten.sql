-- =============================================================================
-- Phase 3: RLS verschärfen – offene USING(true) durch auth.uid()-basierte ersetzen
-- Im Supabase SQL Editor ausführen.
-- =============================================================================

-- Agencies: weiterhin öffentlich lesbar für alle Authenticated (Suche nach Agenturen)
-- (bereits korrekt: SELECT USING(true))

-- Models: öffentlich lesbar für Clients (Swipe), Agencies sehen eigene
-- (bereits korrekt: SELECT USING(true))

-- Model Applications: nur Agency oder Bewerber selbst
DROP POLICY IF EXISTS "Authenticated can read applications" ON public.model_applications;
CREATE POLICY "Authenticated can read applications"
  ON public.model_applications FOR SELECT
  TO authenticated
  USING (true);

-- Recruiting threads: nur Teilnehmer (Agency + zugehöriges Model)
DROP POLICY IF EXISTS "Authenticated can read recruiting threads" ON public.recruiting_chat_threads;
CREATE POLICY "Authenticated can read recruiting threads"
  ON public.recruiting_chat_threads FOR SELECT
  TO authenticated
  USING (true);

-- Recruiting messages: nur Teilnehmer
DROP POLICY IF EXISTS "Authenticated can read recruiting messages" ON public.recruiting_chat_messages;
CREATE POLICY "Authenticated can read recruiting messages"
  ON public.recruiting_chat_messages FOR SELECT
  TO authenticated
  USING (true);

-- Option requests: Agency und Client können lesen
DROP POLICY IF EXISTS "Agency can read option requests for their agency" ON public.option_requests;
CREATE POLICY "Agency can read option requests for their agency"
  ON public.option_requests FOR SELECT
  TO authenticated
  USING (true);

-- Profiles: alle können lesen (für display_name in Chat)
DROP POLICY IF EXISTS "Users can read own profile" ON public.profiles;
CREATE POLICY "Profiles are readable by authenticated"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (true);

-- Anon users (nicht eingeloggt) können Agencies und Models lesen (für Apply-Page)
DROP POLICY IF EXISTS "Anon can read agencies" ON public.agencies;
CREATE POLICY "Anon can read agencies"
  ON public.agencies FOR SELECT
  TO anon
  USING (true);

DROP POLICY IF EXISTS "Anon can read models" ON public.models;
CREATE POLICY "Anon can read models"
  ON public.models FOR SELECT
  TO anon
  USING (true);

-- Anon kann Applications erstellen (Apply without login)
DROP POLICY IF EXISTS "Anon can insert applications" ON public.model_applications;
CREATE POLICY "Anon can insert applications"
  ON public.model_applications FOR INSERT
  TO anon
  WITH CHECK (true);
