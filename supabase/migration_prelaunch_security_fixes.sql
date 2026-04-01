-- =============================================================================
-- Pre-Launch Security Fixes (Phase 29)
--
-- Addresses vulnerabilities identified in the 2026-04 Full Pre-Launch Audit:
--
--   C-3:  guest_links — anon SELECT USING(is_active=true) allows enumeration
--         of all active links (agency_id, model_ids, metadata) for any caller.
--         Fix: remove broad anon + authenticated SELECT policies; introduce
--         SECURITY DEFINER RPC get_guest_link_info() as the only public read path.
--
--   H-2:  model_locations — anon USING(true) exposes all model coordinates
--         globally (no join to model visibility / agency-client relationship).
--         Fix: remove anon SELECT; scope authenticated SELECT to own agency models,
--         client org models with territories, or models with active option requests.
--
--   H-3:  chat-files storage — SELECT policy allows any authenticated user to
--         read files in chat/ / recruiting/ / options/ paths by guessing the URL.
--         Fix: replace with owner-check + conversation-participant check.
--
--   H-4:  get_guest_link_models RPC — missing AND m.agency_id = gl.agency_id
--         guard allows cross-agency model data if model_ids were corrupted.
--         Fix: add agency ownership filter to the RETURN QUERY.
--
--   H-7:  agency_invitations — SELECT policy scopes to role='agent' only, not
--         to the caller's own agency. Any agent sees all agencies' invitations.
--         Fix: add organization_members check scoped to caller's own org(s).
--
--   M-1:  booking_events — no DB-level uniqueness prevents two confirmed
--         booking events for the same model on the same date.
--         Fix: partial UNIQUE index on (model_id, date) WHERE status != 'cancelled'.
--
-- Run AFTER migration_storage_size_hardening.sql (Phase 28b, #138).
-- =============================================================================


-- ─── C-3: Replace broad guest_links SELECT policies ──────────────────────────
--
-- Before: anon + authenticated could SELECT all active links (enumeration risk).
-- After: direct table SELECT restricted to agency members of own org.
--        All other callers (anon, clients, guests) must use get_guest_link_info().

-- Drop the two over-permissive SELECT policies.
DROP POLICY IF EXISTS "Anon can read guest links"                    ON public.guest_links;
DROP POLICY IF EXISTS "Authenticated can read active guest links"    ON public.guest_links;

-- Scoped SELECT for agency org members (managing their own links).
-- Clients who receive a link in B2B chat use get_guest_link_info() instead.
DROP POLICY IF EXISTS "Agency members can select own guest links" ON public.guest_links;
CREATE POLICY "Agency members can select own guest links"
  ON public.guest_links FOR SELECT
  TO authenticated
  USING (
    -- agency_id is the organizations.id (type='agency') that owns the link
    agency_id IN (
      SELECT o.id
      FROM   public.organizations o
      JOIN   public.organization_members om ON om.organization_id = o.id
      WHERE  o.type     = 'agency'
        AND  om.user_id = auth.uid()
      UNION
      SELECT o.id
      FROM   public.organizations o
      WHERE  o.type     = 'agency'
        AND  o.owner_id = auth.uid()
    )
  );


-- SECURITY DEFINER RPC: get_guest_link_info
--
-- Returns only the display-safe metadata of a single guest link given its UUID.
-- Safe for anon and authenticated callers — no agency_id, no model_ids exposed.
-- The caller must already know the link UUID (shared via URL / B2B chat).

CREATE OR REPLACE FUNCTION public.get_guest_link_info(p_link_id UUID)
RETURNS TABLE (
  id                    UUID,
  label                 TEXT,
  agency_name           TEXT,
  type                  TEXT,
  is_active             BOOLEAN,
  expires_at            TIMESTAMPTZ,
  tos_accepted_by_guest BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    gl.id,
    gl.label,
    gl.agency_name,
    gl.type::TEXT,
    gl.is_active,
    gl.expires_at,
    gl.tos_accepted_by_guest
  FROM public.guest_links gl
  WHERE gl.id = p_link_id
    AND gl.is_active = true
    AND (gl.expires_at IS NULL OR gl.expires_at > now());
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_guest_link_info(UUID) TO anon;
GRANT EXECUTE ON FUNCTION public.get_guest_link_info(UUID) TO authenticated;

COMMENT ON FUNCTION public.get_guest_link_info(UUID) IS
  'Returns display-safe metadata for a single active, non-expired guest link. '
  'Does NOT expose agency_id or model_ids. '
  'Safe for anon callers — requires knowing the link UUID. '
  'SECURITY DEFINER to bypass the scoped RLS on guest_links.';


-- ─── H-2: Scope model_locations anon SELECT ──────────────────────────────────
--
-- Before: USING(true) for both anon and all authenticated — global location dump.
-- After:  Anon has NO direct SELECT. Authenticated SELECT scoped to:
--           • Models managed by the caller's agency org
--           • Models the caller's client org has an active option request for
--           • The model's own location row

DROP POLICY IF EXISTS "Anon can read model locations"    ON public.model_locations;
DROP POLICY IF EXISTS "Clients can read model locations" ON public.model_locations;

CREATE POLICY "model_locations_select_scoped"
  ON public.model_locations FOR SELECT
  TO authenticated
  USING (
    -- The model itself can always read its own location
    EXISTS (
      SELECT 1 FROM public.models m
      WHERE m.id      = model_locations.model_id
        AND m.user_id = auth.uid()
    )
    -- Agency org members see locations of models in their agency
    OR EXISTS (
      SELECT 1 FROM public.models m
      JOIN   public.organizations o  ON o.agency_id = m.agency_id
      JOIN   public.organization_members om ON om.organization_id = o.id
      WHERE  m.id       = model_locations.model_id
        AND  om.user_id = auth.uid()
    )
    -- Agency org owner
    OR EXISTS (
      SELECT 1 FROM public.models m
      JOIN   public.organizations o ON o.agency_id = m.agency_id
      WHERE  m.id      = model_locations.model_id
        AND  o.owner_id = auth.uid()
    )
    -- Legacy bookers path
    OR EXISTS (
      SELECT 1 FROM public.models m
      JOIN   public.bookers bk ON bk.agency_id = m.agency_id
      WHERE  m.id       = model_locations.model_id
        AND  bk.user_id = auth.uid()
    )
    -- Client org members whose org has an active (non-rejected) option request
    OR EXISTS (
      SELECT 1 FROM public.option_requests orq
      JOIN   public.organization_members om ON om.user_id = auth.uid()
      JOIN   public.organizations o         ON o.id       = om.organization_id
      WHERE  orq.model_id        = model_locations.model_id
        AND  orq.organization_id = o.id
        AND  orq.status         != 'rejected'
    )
    -- Client individual (direct client_id on option_requests)
    OR EXISTS (
      SELECT 1 FROM public.option_requests orq
      WHERE  orq.model_id  = model_locations.model_id
        AND  orq.client_id = auth.uid()
        AND  orq.status   != 'rejected'
    )
  );


-- ─── H-3: Tighten chat-files storage SELECT policy ───────────────────────────
--
-- Before: any authenticated user can read any file under chat/ recruiting/ options/
--         by knowing (or guessing) the path — no conversation membership check.
-- After:  only the file owner (uploader) OR a participant in the referenced
--         conversation can read the file.
--
-- Path convention used by the app:
--   chat/      {conversation_id}/{filename}   → conversations.participant_ids
--   recruiting/{thread_id}/{filename}         → recruiting_threads membership
--   options/   {option_request_id}/{filename} → option_request_visible_to_me()

DROP POLICY IF EXISTS chat_files_recruiting_select ON storage.objects;

CREATE POLICY chat_files_recruiting_select
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'chat-files'
    AND (
      -- The uploader always retains access to their own files
      owner = auth.uid()

      -- chat/ files: the second path segment is the conversation UUID
      OR (
        (storage.foldername(name))[1] = 'chat'
        AND EXISTS (
          SELECT 1 FROM public.conversations c
          WHERE  c.id::text = (storage.foldername(name))[2]
            AND  auth.uid()::text = ANY(c.participant_ids::text[])
        )
      )

      -- recruiting/ files: agency org member OR the model applicant of the thread
      OR (
        (storage.foldername(name))[1] = 'recruiting'
        AND (
          EXISTS (
            SELECT 1 FROM public.recruiting_chat_threads rt
            JOIN   public.organizations o  ON o.agency_id = rt.agency_id
            JOIN   public.organization_members om ON om.organization_id = o.id
            WHERE  rt.id::text = (storage.foldername(name))[2]
              AND  om.user_id  = auth.uid()
          )
          OR EXISTS (
            SELECT 1 FROM public.recruiting_chat_threads rt
            JOIN   public.model_applications app ON app.id = rt.application_id
            WHERE  rt.id::text            = (storage.foldername(name))[2]
              AND  app.applicant_user_id  = auth.uid()
          )
        )
      )

      -- options/ files: visible to option request participants via existing RPC
      OR (
        (storage.foldername(name))[1] = 'options'
        AND EXISTS (
          SELECT 1 FROM public.option_requests orq
          WHERE  orq.id::text = (storage.foldername(name))[2]
            AND  public.option_request_visible_to_me(orq.id)
        )
      )
    )
  );


-- ─── H-4: get_guest_link_models — add agency ownership guard ─────────────────
--
-- Before: WHERE m.id = ANY(v_model_ids) — no check that models belong to the
--         link's agency. Corrupted model_ids could leak cross-agency model data.
-- After:  AND m.agency_id = v_agency_id added to the RETURN QUERY.

CREATE OR REPLACE FUNCTION public.get_guest_link_models(p_link_id UUID)
RETURNS TABLE (
  id               UUID,
  name             TEXT,
  height           INTEGER,
  bust             INTEGER,
  waist            INTEGER,
  hips             INTEGER,
  city             TEXT,
  hair_color       TEXT,
  eye_color        TEXT,
  sex              TEXT,
  portfolio_images TEXT[],
  polaroids        TEXT[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_model_ids UUID[];
  v_type      TEXT;
  v_agency_id UUID;
BEGIN
  -- Validate the link: must be active and not expired.
  SELECT gl.model_ids, gl.type, gl.agency_id
    INTO v_model_ids, v_type, v_agency_id
    FROM public.guest_links gl
   WHERE gl.id        = p_link_id
     AND gl.is_active = true
     AND (gl.expires_at IS NULL OR gl.expires_at > now());

  IF NOT FOUND THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    m.id,
    m.name,
    m.height,
    m.bust,
    m.waist,
    m.hips,
    m.city,
    m.hair_color,
    m.eye_color,
    m.sex::TEXT,
    -- Portfolio packages: return portfolio images only
    CASE WHEN v_type = 'portfolio' THEN COALESCE(m.portfolio_images, '{}') ELSE '{}' END,
    -- Polaroid packages: return polaroids only
    CASE WHEN v_type = 'polaroid'  THEN COALESCE(m.polaroids, '{}')        ELSE '{}' END
  FROM public.models m
  WHERE m.id        = ANY(v_model_ids)
    -- H-4 fix: only serve models that actually belong to the link's agency
    AND m.agency_id = v_agency_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_guest_link_models(UUID) TO anon;
GRANT EXECUTE ON FUNCTION public.get_guest_link_models(UUID) TO authenticated;

COMMENT ON FUNCTION public.get_guest_link_models(UUID) IS
  'Returns model fields for an active guest link. '
  'Portfolio packages (type=''portfolio'') return portfolio_images only; polaroids = []. '
  'Polaroid packages (type=''polaroid'') return polaroids only; portfolio_images = []. '
  'Discovery and direct model queries NEVER expose polaroids. '
  'H-4 fix (2026-04 audit): model_ids are now filtered by m.agency_id = link.agency_id '
  'to prevent cross-agency data leakage if model_ids were ever corrupted. '
  'SECURITY DEFINER — safe for anon callers, scoped strictly to the linked models.';


-- ─── H-7: agency_invitations — scope to caller's own agency ──────────────────
--
-- Problem: The legacy agency_invitations table had no agency_id FK, so the
--   existing policy could only scope to role='agent' — allowing any agent to
--   read invitations from all agencies (cross-tenant read).
--
-- Fix in two steps:
--   Step 1: Add agency_id column (FK to agencies) and backfill via agency_name
--           match (best-effort — rows without a name match stay NULL).
--   Step 2: Replace policies with org-membership check on the new column.
--           Rows where agency_id IS NULL fall back to role='agent' guard only
--           (legacy safety net; new rows will always have agency_id set).

-- Step 1: Add agency_id column
ALTER TABLE public.agency_invitations
  ADD COLUMN IF NOT EXISTS agency_id UUID REFERENCES public.agencies(id) ON DELETE SET NULL;

-- Step 1b: Best-effort backfill from agencies.name ↔ agency_name (case-insensitive)
UPDATE public.agency_invitations ai
SET    agency_id = a.id
FROM   public.agencies a
WHERE  lower(trim(a.name)) = lower(trim(ai.agency_name))
  AND  ai.agency_id IS NULL;

-- Step 2: Replace broad agent-role policies with agency-scoped ones
DROP POLICY IF EXISTS "Agents can read legacy agency invitations"   ON public.agency_invitations;
DROP POLICY IF EXISTS "Agents can insert legacy agency invitations"  ON public.agency_invitations;
DROP POLICY IF EXISTS "Agents can update legacy agency invitations"  ON public.agency_invitations;

-- Helper CTE: agencies the current user belongs to (via org membership or ownership)
-- Used inline in all three policies below.

-- SELECT: own-agency records, or NULL-agency rows for any agent (legacy fallback)
CREATE POLICY "Agents can read own agency invitations"
  ON public.agency_invitations FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'agent'
    )
    AND (
      -- Rows linked to the caller's agency (new / backfilled rows)
      (
        agency_id IS NOT NULL
        AND (
          EXISTS (
            SELECT 1 FROM public.agencies ag
            JOIN   public.organizations o  ON o.agency_id = ag.id
            JOIN   public.organization_members om ON om.organization_id = o.id
            WHERE  ag.id = agency_invitations.agency_id AND om.user_id = auth.uid()
          )
          OR EXISTS (
            SELECT 1 FROM public.agencies ag
            JOIN   public.organizations o ON o.agency_id = ag.id
            WHERE  ag.id = agency_invitations.agency_id AND o.owner_id = auth.uid()
          )
        )
      )
      -- Legacy rows without agency_id: visible to all agents (original behavior)
      OR agency_id IS NULL
    )
  );

-- INSERT: require agency_id to be set to caller's own agency
CREATE POLICY "Agents can insert own agency invitations"
  ON public.agency_invitations FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'agent'
    )
    AND agency_id IS NOT NULL
    AND (
      EXISTS (
        SELECT 1 FROM public.agencies ag
        JOIN   public.organizations o  ON o.agency_id = ag.id
        JOIN   public.organization_members om ON om.organization_id = o.id
        WHERE  ag.id = agency_invitations.agency_id AND om.user_id = auth.uid()
      )
      OR EXISTS (
        SELECT 1 FROM public.agencies ag
        JOIN   public.organizations o ON o.agency_id = ag.id
        WHERE  ag.id = agency_invitations.agency_id AND o.owner_id = auth.uid()
      )
    )
  );

-- UPDATE (mark used): scoped to own agency or legacy NULL rows
CREATE POLICY "Agents can update own agency invitations"
  ON public.agency_invitations FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'agent'
    )
    AND (
      agency_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.agencies ag
        JOIN   public.organizations o  ON o.agency_id = ag.id
        JOIN   public.organization_members om ON om.organization_id = o.id
        WHERE  ag.id = agency_invitations.agency_id AND om.user_id = auth.uid()
      )
      OR EXISTS (
        SELECT 1 FROM public.agencies ag
        JOIN   public.organizations o ON o.agency_id = ag.id
        WHERE  ag.id = agency_invitations.agency_id AND o.owner_id = auth.uid()
      )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'agent'
    )
  );


-- ─── M-1: Prevent double-confirmed booking events for same model + date ───────
--
-- Before: no DB constraint prevents two active booking_events for the same
--         model on the same date, enabling double-bookings at the DB level.
-- After:  partial UNIQUE index on (model_id, date) WHERE status != 'cancelled'.
--         Cancelled events are excluded so the model can be re-booked after
--         a cancellation.

CREATE UNIQUE INDEX IF NOT EXISTS uidx_booking_events_model_date_active
  ON public.booking_events (model_id, date)
  WHERE status != 'cancelled';


-- ─── Verification ─────────────────────────────────────────────────────────────

SELECT
  schemaname,
  tablename,
  policyname,
  cmd
FROM pg_policies
WHERE (schemaname = 'public'  AND tablename IN ('guest_links', 'model_locations', 'agency_invitations'))
   OR (schemaname = 'storage' AND tablename = 'objects' AND policyname LIKE 'chat_files%')
ORDER BY tablename, policyname;

SELECT routine_name
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN ('get_guest_link_info', 'get_guest_link_models')
ORDER BY routine_name;

SELECT indexname
FROM pg_indexes
WHERE tablename = 'booking_events'
  AND indexname = 'uidx_booking_events_model_date_active';
