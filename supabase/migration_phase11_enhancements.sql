-- =============================================================================
-- Phase 11: Feature Enhancements
-- Booker system, extended filters, option workflow, calendar times,
-- profile settings, agency invitations, message archiving
-- =============================================================================

-- 1. Bookers (multiple bookers per agency, each with own login)
CREATE TABLE IF NOT EXISTS public.bookers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  agency_id UUID NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  email TEXT,
  bookings_completed INTEGER DEFAULT 0,
  is_master BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bookers_agency ON public.bookers(agency_id);
CREATE INDEX IF NOT EXISTS idx_bookers_user ON public.bookers(user_id);

-- 2. Extend profiles with client settings
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS company_name TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS website TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS social_links JSONB DEFAULT '{}';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS country TEXT;

-- 3. Extend models with additional measurements
ALTER TABLE public.models ADD COLUMN IF NOT EXISTS legs_inseam INTEGER;
ALTER TABLE public.models ADD COLUMN IF NOT EXISTS chest INTEGER;
ALTER TABLE public.models ADD COLUMN IF NOT EXISTS shoe_size NUMERIC;
ALTER TABLE public.models ADD COLUMN IF NOT EXISTS country TEXT;

-- 4. Extend option_requests with model approval & pricing
ALTER TABLE public.option_requests ADD COLUMN IF NOT EXISTS proposed_price NUMERIC;
ALTER TABLE public.option_requests ADD COLUMN IF NOT EXISTS start_time TIME;
ALTER TABLE public.option_requests ADD COLUMN IF NOT EXISTS end_time TIME;
ALTER TABLE public.option_requests ADD COLUMN IF NOT EXISTS model_approval TEXT DEFAULT 'pending';
ALTER TABLE public.option_requests ADD COLUMN IF NOT EXISTS model_approved_at TIMESTAMPTZ;
ALTER TABLE public.option_requests ADD COLUMN IF NOT EXISTS booker_id UUID;

-- 5. Extend calendar_entries with time and type
ALTER TABLE public.calendar_entries ADD COLUMN IF NOT EXISTS start_time TIME;
ALTER TABLE public.calendar_entries ADD COLUMN IF NOT EXISTS end_time TIME;
ALTER TABLE public.calendar_entries ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE public.calendar_entries ADD COLUMN IF NOT EXISTS entry_type TEXT DEFAULT 'personal';

-- 6. Extend conversations with archiving and country
DO $$ BEGIN
  ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT false;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS country TEXT;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS conversation_category TEXT DEFAULT 'general';
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- 7. Extend messages for booker attribution
DO $$ BEGIN
  ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS booker_id UUID;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS booker_name TEXT;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- 8. Extend option_request_messages for booker attribution
ALTER TABLE public.option_request_messages ADD COLUMN IF NOT EXISTS booker_id UUID;
ALTER TABLE public.option_request_messages ADD COLUMN IF NOT EXISTS booker_name TEXT;

-- 9. Agency invitations
CREATE TABLE IF NOT EXISTS public.agency_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_name TEXT NOT NULL,
  email TEXT NOT NULL,
  invited_by TEXT,
  token TEXT NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  used BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 10. Option documents (files attached to confirmed options)
CREATE TABLE IF NOT EXISTS public.option_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  option_request_id UUID NOT NULL REFERENCES public.option_requests(id) ON DELETE CASCADE,
  uploaded_by TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_url TEXT NOT NULL,
  file_type TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_option_documents_request ON public.option_documents(option_request_id);

-- =============================================================================
-- RLS
-- =============================================================================

ALTER TABLE public.bookers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agency_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.option_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read bookers" ON public.bookers;
CREATE POLICY "Anyone can read bookers" ON public.bookers FOR SELECT USING (true);

DROP POLICY IF EXISTS "Authenticated can manage bookers" ON public.bookers;
CREATE POLICY "Authenticated can manage bookers" ON public.bookers FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Anon can read bookers" ON public.bookers;
CREATE POLICY "Anon can read bookers" ON public.bookers FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS "Anon can insert bookers" ON public.bookers;
CREATE POLICY "Anon can insert bookers" ON public.bookers FOR INSERT TO anon WITH CHECK (true);

DROP POLICY IF EXISTS "Anon can update bookers" ON public.bookers;
CREATE POLICY "Anon can update bookers" ON public.bookers FOR UPDATE TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Anyone can manage invitations" ON public.agency_invitations;
CREATE POLICY "Anyone can manage invitations" ON public.agency_invitations FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Anyone can manage option documents" ON public.option_documents;
CREATE POLICY "Anyone can manage option documents" ON public.option_documents FOR ALL USING (true) WITH CHECK (true);

-- Triggers
DROP TRIGGER IF EXISTS bookers_updated_at ON public.bookers;
CREATE TRIGGER bookers_updated_at
  BEFORE UPDATE ON public.bookers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
