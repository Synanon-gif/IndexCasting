-- =============================================================================
-- Phase 2: Erweitertes Datenmodell
-- Neue Tabellen für Territorien, Follower, Posts, Documents, Verification, Consent
-- Im Supabase SQL Editor ausführen.
-- =============================================================================

-- 1) Multi-Agentur pro Model (Territorien)
CREATE TABLE IF NOT EXISTS public.model_agency_territories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id UUID NOT NULL REFERENCES public.models(id) ON DELETE CASCADE,
  agency_id UUID NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  territory TEXT NOT NULL,
  is_primary BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (model_id, territory)
);

CREATE INDEX IF NOT EXISTS idx_territories_model ON public.model_agency_territories(model_id);
CREATE INDEX IF NOT EXISTS idx_territories_agency ON public.model_agency_territories(agency_id);

-- 2) Agency-zu-Agency Verbindungen
CREATE TABLE IF NOT EXISTS public.agency_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_a_id UUID NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  agency_b_id UUID NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  status connection_status NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (agency_a_id, agency_b_id),
  CHECK (agency_a_id <> agency_b_id)
);

-- 3) Follower-System
CREATE TABLE IF NOT EXISTS public.follows (
  follower_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  followed_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_id, followed_id)
);

CREATE INDEX IF NOT EXISTS idx_follows_followed ON public.follows(followed_id);

-- 4) Posts/Stories
DO $$ BEGIN
  CREATE TYPE post_type AS ENUM ('post', 'story');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type post_type NOT NULL DEFAULT 'post',
  media_urls TEXT[] DEFAULT '{}',
  caption TEXT,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_posts_author ON public.posts(author_id);
CREATE INDEX IF NOT EXISTS idx_posts_type ON public.posts(type);

CREATE TABLE IF NOT EXISTS public.post_likes (
  post_id UUID NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.post_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_comments_post ON public.post_comments(post_id);

-- 5) Verträge/Dokumente
DO $$ BEGIN
  CREATE TYPE document_type AS ENUM ('contract', 'invoice', 'id_document');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type document_type NOT NULL,
  file_path TEXT NOT NULL,
  encrypted BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_documents_owner ON public.documents(owner_id);

-- 6) Verifizierung
DO $$ BEGIN
  CREATE TYPE verification_status AS ENUM ('pending', 'verified', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  id_document_path TEXT NOT NULL,
  status verification_status NOT NULL DEFAULT 'pending',
  verified_by_agency_id UUID REFERENCES public.agencies(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 7) AGB/Datenschutz-Zustimmung
DO $$ BEGIN
  CREATE TYPE consent_type AS ENUM ('terms', 'privacy');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.consent_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  consent_type consent_type NOT NULL,
  version TEXT NOT NULL,
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip_address TEXT
);

CREATE INDEX IF NOT EXISTS idx_consent_user ON public.consent_log(user_id);

-- =============================================================================
-- RLS
-- =============================================================================

ALTER TABLE public.model_agency_territories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agency_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.follows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.post_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.post_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consent_log ENABLE ROW LEVEL SECURITY;

-- Territories: readable by all authenticated
CREATE POLICY "Authenticated can read territories"
  ON public.model_agency_territories FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can manage territories"
  ON public.model_agency_territories FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Agency connections: readable by participants
CREATE POLICY "Agencies can read their connections"
  ON public.agency_connections FOR SELECT TO authenticated USING (true);
CREATE POLICY "Agencies can manage connections"
  ON public.agency_connections FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Follows
CREATE POLICY "Users can read follows"
  ON public.follows FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users can manage own follows"
  ON public.follows FOR ALL TO authenticated USING (follower_id = auth.uid()) WITH CHECK (follower_id = auth.uid());

-- Posts: public read, owner write
CREATE POLICY "Anyone can read posts"
  ON public.posts FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users can manage own posts"
  ON public.posts FOR ALL TO authenticated USING (author_id = auth.uid()) WITH CHECK (author_id = auth.uid());

-- Post likes
CREATE POLICY "Anyone can read likes"
  ON public.post_likes FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users can manage own likes"
  ON public.post_likes FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- Post comments
CREATE POLICY "Anyone can read comments"
  ON public.post_comments FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users can manage own comments"
  ON public.post_comments FOR ALL TO authenticated USING (author_id = auth.uid()) WITH CHECK (author_id = auth.uid());

-- Documents: only owner
CREATE POLICY "Users can read own documents"
  ON public.documents FOR SELECT TO authenticated USING (owner_id = auth.uid());
CREATE POLICY "Users can manage own documents"
  ON public.documents FOR ALL TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());

-- Verifications
CREATE POLICY "Users can read own verification"
  ON public.verifications FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Users can insert verification"
  ON public.verifications FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "Agency can update verification"
  ON public.verifications FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- Consent log: only owner
CREATE POLICY "Users can read own consent"
  ON public.consent_log FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Users can insert consent"
  ON public.consent_log FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

-- Triggers for updated_at
CREATE TRIGGER agency_connections_updated_at
  BEFORE UPDATE ON public.agency_connections
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER posts_updated_at
  BEFORE UPDATE ON public.posts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER verifications_updated_at
  BEFORE UPDATE ON public.verifications
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
