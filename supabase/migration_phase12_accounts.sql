-- =============================================================================
-- Phase 12: Account Management, Guest Mode, Admin, ToS/Privacy, Client Bookers
-- =============================================================================

-- 1. Extend profiles: activation, ToS, admin flag
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT false;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT false;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS tos_accepted BOOLEAN DEFAULT false;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS privacy_accepted BOOLEAN DEFAULT false;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS agency_model_rights_accepted BOOLEAN DEFAULT false;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS tos_accepted_at TIMESTAMPTZ;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS privacy_accepted_at TIMESTAMPTZ;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS activation_documents_sent BOOLEAN DEFAULT false;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS verification_email TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS deactivated_reason TEXT;

-- 2. Extend bookers: support client bookers (make agency_id nullable, add client_id)
ALTER TABLE public.bookers ALTER COLUMN agency_id DROP NOT NULL;
ALTER TABLE public.bookers ADD COLUMN IF NOT EXISTS client_id UUID;

DO $$ BEGIN
  ALTER TABLE public.bookers
    ADD CONSTRAINT bookers_owner_check
    CHECK (
      (agency_id IS NOT NULL AND client_id IS NULL)
      OR (agency_id IS NULL AND client_id IS NOT NULL)
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_bookers_client ON public.bookers(client_id);

-- 3. Guest share links
CREATE TABLE IF NOT EXISTS public.guest_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id UUID NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  model_ids UUID[] NOT NULL DEFAULT '{}',
  agency_email TEXT,
  agency_name TEXT,
  created_by UUID REFERENCES auth.users(id),
  expires_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT true,
  tos_accepted_by_guest BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_guest_links_agency ON public.guest_links(agency_id);

-- 4. Admin audit log (DSGVO-compliant)
CREATE TABLE IF NOT EXISTS public.admin_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID NOT NULL REFERENCES auth.users(id),
  action TEXT NOT NULL,
  target_user_id UUID,
  target_table TEXT,
  target_record_id UUID,
  details JSONB DEFAULT '{}',
  ip_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_logs_admin ON public.admin_logs(admin_id);
CREATE INDEX IF NOT EXISTS idx_admin_logs_target ON public.admin_logs(target_user_id);
CREATE INDEX IF NOT EXISTS idx_admin_logs_created ON public.admin_logs(created_at DESC);

-- 5. Terms & conditions / privacy policy acceptance log (immutable)
CREATE TABLE IF NOT EXISTS public.legal_acceptances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL,
  document_version TEXT NOT NULL DEFAULT '1.0',
  accepted BOOLEAN NOT NULL DEFAULT true,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_legal_acceptances_user ON public.legal_acceptances(user_id);

-- =============================================================================
-- RLS
-- =============================================================================

ALTER TABLE public.guest_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.legal_acceptances ENABLE ROW LEVEL SECURITY;

-- Guest links: creator and agency members can manage, anyone with link can read
DROP POLICY IF EXISTS "Agency members can manage guest links" ON public.guest_links;
CREATE POLICY "Agency members can manage guest links"
  ON public.guest_links FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Anon can read guest links" ON public.guest_links;
CREATE POLICY "Anon can read guest links"
  ON public.guest_links FOR SELECT TO anon
  USING (is_active = true);

-- Admin logs: only admins can read/write
DROP POLICY IF EXISTS "Admins can manage audit logs" ON public.admin_logs;
CREATE POLICY "Admins can manage audit logs"
  ON public.admin_logs FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true)
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true)
  );

-- Legal acceptances: users can insert own, admins can read all
DROP POLICY IF EXISTS "Users can insert own legal acceptances" ON public.legal_acceptances;
CREATE POLICY "Users can insert own legal acceptances"
  ON public.legal_acceptances FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can read own legal acceptances" ON public.legal_acceptances;
CREATE POLICY "Users can read own legal acceptances"
  ON public.legal_acceptances FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true)
  );

-- Update bookers RLS to also handle client bookers
DROP POLICY IF EXISTS "Authenticated can manage bookers" ON public.bookers;
CREATE POLICY "Authenticated can manage bookers"
  ON public.bookers FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- =============================================================================
-- Helper function: admin can activate/deactivate accounts
-- =============================================================================
CREATE OR REPLACE FUNCTION public.admin_set_account_active(
  target_id UUID,
  active BOOLEAN,
  reason TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  caller_is_admin BOOLEAN;
BEGIN
  SELECT is_admin INTO caller_is_admin FROM public.profiles WHERE id = auth.uid();
  IF NOT COALESCE(caller_is_admin, false) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  UPDATE public.profiles
  SET is_active = active,
      deactivated_at = CASE WHEN NOT active THEN now() ELSE NULL END,
      deactivated_reason = CASE WHEN NOT active THEN reason ELSE NULL END,
      updated_at = now()
  WHERE id = target_id;

  INSERT INTO public.admin_logs (admin_id, action, target_user_id, details)
  VALUES (
    auth.uid(),
    CASE WHEN active THEN 'activate_account' ELSE 'deactivate_account' END,
    target_id,
    jsonb_build_object('reason', reason)
  );

  RETURN true;
END;
$$;

-- Helper function: admin can edit user profile fields
CREATE OR REPLACE FUNCTION public.admin_update_profile(
  target_id UUID,
  field_name TEXT,
  field_value TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  caller_is_admin BOOLEAN;
  old_value TEXT;
BEGIN
  SELECT is_admin INTO caller_is_admin FROM public.profiles WHERE id = auth.uid();
  IF NOT COALESCE(caller_is_admin, false) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF field_name NOT IN ('display_name', 'email', 'company_name', 'phone', 'website', 'country', 'verification_email') THEN
    RAISE EXCEPTION 'Field not allowed: %', field_name;
  END IF;

  EXECUTE format('SELECT %I::text FROM public.profiles WHERE id = $1', field_name)
    INTO old_value USING target_id;

  EXECUTE format('UPDATE public.profiles SET %I = $1, updated_at = now() WHERE id = $2', field_name)
    USING field_value, target_id;

  INSERT INTO public.admin_logs (admin_id, action, target_user_id, details)
  VALUES (
    auth.uid(),
    'update_profile_field',
    target_id,
    jsonb_build_object('field', field_name, 'old_value', old_value, 'new_value', field_value)
  );

  RETURN true;
END;
$$;
