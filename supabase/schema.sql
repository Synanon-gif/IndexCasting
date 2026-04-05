-- =============================================================================
-- ⚠️  VERALTET / DEPRECATED – NUR HISTORISCHE REFERENZ – NIEMALS AUSFÜHREN ⚠️
-- =============================================================================
-- Diese Datei ist ein einmaliger Snapshot und entspricht NICHT mehr dem
-- aktuellen Datenbankzustand. Der tatsächliche Stand ergibt sich
-- ausschließlich aus der geordneten Anwendung aller Migrations-Dateien
-- gemäß MIGRATION_ORDER.md.
--
-- KRITISCH: NICHT in einer bestehenden oder neuen Produktions-DB ausführen!
--   - CREATE TYPE user_role AS ENUM ('model', 'agent', 'client') FEHLT 'admin'
--     und 'guest' → würde Admin-Login und Guest-Flow brechen.
--   - ::user_role Casts in Funktionen würden für admin/guest-Profile einen
--     runtime-crash verursachen.
--   - Die aktuelle DB nutzt TEXT für profiles.role (kein Postgres ENUM).
--
-- Für einen DB-Reset: alle Migrationen in der in MIGRATION_ORDER.md
-- angegebenen Reihenfolge auf einer leeren DB ausführen, beginnend mit
-- den Dateien im Ordner supabase/migrations/.
-- =============================================================================
--
-- Casting Index – Vollständiges Supabase-Schema
-- Basiert auf: Models, Agenturen, Clients, Swiping, Optionsanfragen, Chats,
-- Bewerbungen (Apply), Freundschaften Client–Agentur, Projekte.
-- Alle Tabellen mit Row Level Security (RLS).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- ENUMS
-- -----------------------------------------------------------------------------

-- ⚠️  DEPRECATED: user_role ENUM ist nicht mehr aktiv.
-- Die aktuelle DB speichert profiles.role als TEXT mit CHECK-Constraint.
-- 'admin' und 'guest' fehlen hier → NICHT ausführen.
-- CREATE TYPE user_role AS ENUM ('model', 'agent', 'client');

CREATE TYPE application_status AS ENUM ('pending', 'accepted', 'rejected');

CREATE TYPE gender AS ENUM ('female', 'male', 'diverse');

CREATE TYPE connection_status AS ENUM ('pending', 'accepted');

CREATE TYPE connection_requested_by AS ENUM ('client', 'agency');

CREATE TYPE option_request_status AS ENUM ('in_negotiation', 'confirmed', 'rejected');

CREATE TYPE chat_sender_type AS ENUM ('client', 'agency', 'model');

-- -----------------------------------------------------------------------------
-- TABELLEN: Nutzer & Agenturen
-- -----------------------------------------------------------------------------

-- Profile (erweitert auth.users; Verknüpfung über auth.uid())
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  display_name TEXT,
  role user_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Agenturen (Studio Marais, Canal Casting, …)
CREATE TABLE public.agencies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  city TEXT,
  focus TEXT,
  email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Models (gehören einer Agentur, optional einem User/Profil)
CREATE TABLE public.models (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id UUID NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  mediaslide_sync_id TEXT,
  name TEXT NOT NULL,
  height INTEGER NOT NULL,
  bust INTEGER,
  waist INTEGER,
  hips INTEGER,
  city TEXT,
  hair_color TEXT,
  eye_color TEXT,
  current_location TEXT,
  portfolio_images TEXT[] DEFAULT '{}',
  polaroids TEXT[] DEFAULT '{}',
  video_url TEXT,
  is_visible_commercial BOOLEAN NOT NULL DEFAULT true,
  is_visible_fashion BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- Bewerbungen (Apply-Formular: Größe, Maße, Instagram, Bilder, …)
-- -----------------------------------------------------------------------------

CREATE TABLE public.model_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id UUID REFERENCES public.agencies(id) ON DELETE SET NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  age INTEGER NOT NULL,
  height INTEGER NOT NULL,
  gender gender,
  hair_color TEXT,
  city TEXT,
  instagram_link TEXT,
  images JSONB DEFAULT '{}',
  status application_status NOT NULL DEFAULT 'pending',
  recruiting_thread_id UUID,
  accepted_by_agency_id UUID REFERENCES public.agencies(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON COLUMN public.model_applications.images IS 'JSON: closeUp, fullBody, profile (image URLs)';

-- -----------------------------------------------------------------------------
-- Recruiting-Chat (Agentur ↔ Model nach akzeptierter Bewerbung)
-- -----------------------------------------------------------------------------

CREATE TABLE public.recruiting_chat_threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES public.model_applications(id) ON DELETE CASCADE,
  model_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Zyklischer FK: Thread erst nach Application anlegen, dann hier setzen
ALTER TABLE public.model_applications
  ADD CONSTRAINT fk_recruiting_thread
  FOREIGN KEY (recruiting_thread_id) REFERENCES public.recruiting_chat_threads(id) ON DELETE SET NULL;

CREATE TABLE public.recruiting_chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id UUID NOT NULL REFERENCES public.recruiting_chat_threads(id) ON DELETE CASCADE,
  from_role chat_sender_type NOT NULL CHECK (from_role IN ('agency', 'model')),
  text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_recruiting_messages_thread ON public.recruiting_chat_messages(thread_id);

-- -----------------------------------------------------------------------------
-- Client–Agentur Verbindungen („Freundschaftsanfragen“)
-- -----------------------------------------------------------------------------

CREATE TABLE public.client_agency_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  agency_id UUID NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  status connection_status NOT NULL DEFAULT 'pending',
  requested_by connection_requested_by NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, agency_id)
);

CREATE INDEX idx_connections_client ON public.client_agency_connections(client_id);
CREATE INDEX idx_connections_agency ON public.client_agency_connections(agency_id);

-- -----------------------------------------------------------------------------
-- Client-Projekte (Kunde legt Projekte an, fügt Models hinzu)
-- -----------------------------------------------------------------------------

CREATE TABLE public.client_projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.client_project_models (
  project_id UUID NOT NULL REFERENCES public.client_projects(id) ON DELETE CASCADE,
  model_id UUID NOT NULL REFERENCES public.models(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, model_id)
);

CREATE INDEX idx_project_models_project ON public.client_project_models(project_id);

-- -----------------------------------------------------------------------------
-- Optionsanfragen (Kunde fragt Datum für Model an → Chat mit Agentur)
-- -----------------------------------------------------------------------------

CREATE TABLE public.option_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  model_id UUID NOT NULL REFERENCES public.models(id) ON DELETE CASCADE,
  agency_id UUID NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  requested_date DATE NOT NULL,
  status option_request_status NOT NULL DEFAULT 'in_negotiation',
  project_id UUID REFERENCES public.client_projects(id) ON DELETE SET NULL,
  client_name TEXT,
  model_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_option_requests_client ON public.option_requests(client_id);
CREATE INDEX idx_option_requests_agency ON public.option_requests(agency_id);
CREATE INDEX idx_option_requests_project ON public.option_requests(project_id);

CREATE TABLE public.option_request_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  option_request_id UUID NOT NULL REFERENCES public.option_requests(id) ON DELETE CASCADE,
  from_role chat_sender_type NOT NULL CHECK (from_role IN ('client', 'agency')),
  text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_option_messages_request ON public.option_request_messages(option_request_id);

-- =============================================================================
-- ROW LEVEL SECURITY (RLS)
-- =============================================================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.models ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.model_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recruiting_chat_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recruiting_chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_agency_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_project_models ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.option_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.option_request_messages ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- Policies: profiles
-- -----------------------------------------------------------------------------

CREATE POLICY "Users can read own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

-- -----------------------------------------------------------------------------
-- Policies: agencies (alle eingeloggten Nutzer dürfen lesen)
-- -----------------------------------------------------------------------------

CREATE POLICY "Authenticated can read agencies"
  ON public.agencies FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Only service role can modify agencies"
  ON public.agencies FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- -----------------------------------------------------------------------------
-- Policies: models (Clients sehen sichtbare; Agentur sieht eigene)
-- -----------------------------------------------------------------------------

CREATE POLICY "Anyone authenticated can read visible models"
  ON public.models FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Agency can update own models"
  ON public.models FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'agent'
      -- Optional: Verknüpfung agency_id ↔ profiles (z. B. über agency_members)
    )
  );

-- Vereinfacht: Lese-Zugriff für alle Auth-User; Schreibzugriff später über agency_id verfeinern
CREATE POLICY "Service role full access models"
  ON public.models FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- -----------------------------------------------------------------------------
-- Policies: model_applications (Agentur liest/aktualisiert)
-- -----------------------------------------------------------------------------

CREATE POLICY "Authenticated can read applications"
  ON public.model_applications FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated can insert applications"
  ON public.model_applications FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated can update applications"
  ON public.model_applications FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- -----------------------------------------------------------------------------
-- Policies: recruiting_chat_threads & messages
-- -----------------------------------------------------------------------------

CREATE POLICY "Authenticated can read recruiting threads"
  ON public.recruiting_chat_threads FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated can insert recruiting threads"
  ON public.recruiting_chat_threads FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated can read recruiting messages"
  ON public.recruiting_chat_messages FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated can insert recruiting messages"
  ON public.recruiting_chat_messages FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- -----------------------------------------------------------------------------
-- Policies: client_agency_connections
-- -----------------------------------------------------------------------------

CREATE POLICY "Clients can read own connections"
  ON public.client_agency_connections FOR SELECT
  TO authenticated
  USING (client_id = auth.uid());

CREATE POLICY "Agencies can read connections where they are agency"
  ON public.client_agency_connections FOR SELECT
  TO authenticated
  USING (
    agency_id IN (SELECT id FROM public.agencies)  -- später: agency_id = user's agency
  );

CREATE POLICY "Users can create connection as client"
  ON public.client_agency_connections FOR INSERT
  TO authenticated
  WITH CHECK (client_id = auth.uid() OR requested_by = 'agency');

CREATE POLICY "Users can update connection (accept/reject) if participant"
  ON public.client_agency_connections FOR UPDATE
  TO authenticated
  USING (client_id = auth.uid())
  WITH CHECK (client_id = auth.uid());

-- Zusätzlich: Agency kann Verbindung akzeptieren/ablehnen
CREATE POLICY "Agency can update connection status"
  ON public.client_agency_connections FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- -----------------------------------------------------------------------------
-- Policies: client_projects & client_project_models
-- -----------------------------------------------------------------------------

CREATE POLICY "Users can CRUD own projects"
  ON public.client_projects FOR ALL
  TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

CREATE POLICY "Users can CRUD project_models for own projects"
  ON public.client_project_models FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.client_projects cp
      WHERE cp.id = project_id AND cp.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.client_projects cp
      WHERE cp.id = project_id AND cp.owner_id = auth.uid()
    )
  );

-- -----------------------------------------------------------------------------
-- Policies: option_requests & option_request_messages
-- -----------------------------------------------------------------------------

CREATE POLICY "Client can read own option requests"
  ON public.option_requests FOR SELECT
  TO authenticated
  USING (client_id = auth.uid());

CREATE POLICY "Agency can read option requests for their agency"
  ON public.option_requests FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Client can create option request"
  ON public.option_requests FOR INSERT
  TO authenticated
  WITH CHECK (client_id = auth.uid());

CREATE POLICY "Client or agency can update option request"
  ON public.option_requests FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Participants can read option messages"
  ON public.option_request_messages FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.option_requests oq
      WHERE oq.id = option_request_id
        AND (oq.client_id = auth.uid() OR oq.agency_id IN (SELECT id FROM public.agencies))
    )
  );

CREATE POLICY "Participants can insert option messages"
  ON public.option_request_messages FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- =============================================================================
-- HILFSFUNKTIONEN & TRIGGER (updated_at)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER agencies_updated_at
  BEFORE UPDATE ON public.agencies
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER models_updated_at
  BEFORE UPDATE ON public.models
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER model_applications_updated_at
  BEFORE UPDATE ON public.model_applications
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER client_agency_connections_updated_at
  BEFORE UPDATE ON public.client_agency_connections
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER client_projects_updated_at
  BEFORE UPDATE ON public.client_projects
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER option_requests_updated_at
  BEFORE UPDATE ON public.option_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =============================================================================
-- OPTIONAL: FK model_applications.recruiting_thread_id nach Thread-Erstellung
-- (Application wird erst nach „Accept“ mit Thread verknüpft; Thread wird vorher
-- angelegt, dann application.recruiting_thread_id gesetzt.)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Trigger: Profil bei neuem Auth-User anlegen
-- -----------------------------------------------------------------------------

-- ⚠️  DEPRECATED: Diese handle_new_user-Version verwendet ::user_role ENUM-Cast.
-- Die aktuelle Version steht in supabase/migrations/20260406_handle_new_user_role_sanitize.sql
-- und nutzt eine Text-Allowlist ohne ENUM-Cast. NICHT ausführen.
-- CREATE OR REPLACE FUNCTION public.handle_new_user()
-- RETURNS TRIGGER AS $$
-- BEGIN
--   INSERT INTO public.profiles (id, email, display_name, role)
--   VALUES (
--     NEW.id,
--     NEW.email,
--     COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
--     COALESCE((NEW.raw_user_meta_data->>'role')::user_role, 'client')  -- ENUM-Cast: GEFÄHRLICH für admin/guest
--   )
--   ON CONFLICT (id) DO NOTHING;
--   RETURN NEW;
-- END;
-- $$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
