-- =============================================================================
-- Guest-to-Client Flow
-- Adds is_guest + has_completed_signup to profiles,
-- guest_user_id to conversations, and matching RLS policies.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. profiles: guest flags
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_guest BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS has_completed_signup BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profiles.is_guest IS
  'True for lightweight Magic-Link accounts created through a guest link. '
  'These users have no client organization and limited platform access.';

COMMENT ON COLUMN public.profiles.has_completed_signup IS
  'True once the guest has upgraded to a full client account '
  '(organization created, is_guest set to false).';

-- ---------------------------------------------------------------------------
-- 2. conversations: label guest chats for agency-side rendering
-- ---------------------------------------------------------------------------
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS guest_user_id UUID
    REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_guest_user
  ON public.conversations(guest_user_id)
  WHERE guest_user_id IS NOT NULL;

COMMENT ON COLUMN public.conversations.guest_user_id IS
  'Set when the conversation was started by a guest (Magic-Link) user. '
  'Lets the agency UI label the chat as "Guest Client".';

-- ---------------------------------------------------------------------------
-- 3. RLS — profiles
-- The existing schema already has RLS on profiles.
-- We make sure guests can read and update their own row.
-- ---------------------------------------------------------------------------

-- Allow every authenticated user to read their own profile row.
-- (Most setups already have this; DROP IF EXISTS avoids duplicate errors.)
DROP POLICY IF EXISTS "Users can read own profile" ON public.profiles;
CREATE POLICY "Users can read own profile"
  ON public.profiles FOR SELECT TO authenticated
  USING (id = auth.uid());

-- Allow every authenticated user to update their own profile row.
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- Allow every authenticated user to insert their own profile row (initial upsert).
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
CREATE POLICY "Users can insert own profile"
  ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (id = auth.uid());

-- ---------------------------------------------------------------------------
-- 4. RLS — guest_links: allow authenticated guests to read by id
-- (Needed so GuestView can reload the link data post-auth.)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Authenticated can read active guest links" ON public.guest_links;
CREATE POLICY "Authenticated can read active guest links"
  ON public.guest_links FOR SELECT TO authenticated
  USING (is_active = true);

-- ---------------------------------------------------------------------------
-- 5. Helper RPC: upgrade_guest_to_client
-- Atomically flips is_guest/has_completed_signup and creates the client org.
-- Called from guestAuthSupabase.ts upgradeGuestToClient().
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.upgrade_guest_to_client(
  p_company_name TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid         UUID  := auth.uid();
  v_org_id      UUID;
  v_company     TEXT  := COALESCE(NULLIF(TRIM(p_company_name), ''), 'My Company');
BEGIN
  -- Guard: caller must be a guest
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = v_uid AND is_guest = true
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_a_guest');
  END IF;

  -- Create client organization
  INSERT INTO public.organizations (name, type, owner_id)
  VALUES (v_company, 'client', v_uid)
  RETURNING id INTO v_org_id;

  -- Add caller as owner member
  INSERT INTO public.organization_members (organization_id, user_id, role)
  VALUES (v_org_id, v_uid, 'owner');

  -- Flip profile flags
  UPDATE public.profiles
  SET is_guest            = false,
      has_completed_signup = true,
      is_active           = true,
      updated_at          = now()
  WHERE id = v_uid;

  RETURN jsonb_build_object('ok', true, 'organization_id', v_org_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.upgrade_guest_to_client(TEXT) TO authenticated;
