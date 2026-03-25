-- =============================================================================
-- Agency Bookers Full Access Fix
--
-- Problem: bookers-Tabelle (bookers.user_id + bookers.agency_id) wird von
--   fast keiner RLS-Policy oder RPC berücksichtigt. Nur organization_members
--   wird geprüft. Das blockiert Booker-Zugänge die per bookers-Tabelle
--   (Legacy oder direkt) angelegt wurden.
--
-- Diese Migration erweitert:
--   1. get_my_agency_member_role RPC  → liefert 'booker' auch via bookers-Tabelle
--   2. conversation_accessible_to_me  → B2B-Chats zugänglich für Booker
--   3. Models RLS (SELECT/UPDATE/INSERT) → Booker können Agentur-Modelle lesen/schreiben
--   4. create_b2b_org_conversation RPC → Booker können B2B-Chats erstellen
-- =============================================================================

-- =============================================================================
-- 1. get_my_agency_member_role RPC
--    Gibt Rolle + org_id zurück. Prüft jetzt BEIDE Pfade:
--    a) organization_members (neue Einladungs-Booker)
--    b) bookers-Tabelle (Legacy oder direkte Einträge)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.get_my_agency_member_role(p_agency_id uuid)
RETURNS TABLE(member_role text, organization_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- Pfad A: organization_members (bevorzugt, hat richtige org_id)
  SELECT m.role::text AS member_role, m.organization_id
  FROM public.organization_members m
  JOIN public.organizations o ON o.id = m.organization_id
  WHERE m.user_id = auth.uid()
    AND o.agency_id = p_agency_id
    AND o.type = 'agency'
  LIMIT 1

  UNION ALL

  -- Pfad B: bookers-Tabelle — nur wenn kein organization_members Treffer gefunden
  SELECT 'booker'::text AS member_role,
         o.id           AS organization_id
  FROM public.bookers b
  LEFT JOIN public.organizations o
    ON o.agency_id = b.agency_id AND o.type = 'agency'
  WHERE b.user_id   = auth.uid()
    AND b.agency_id = p_agency_id
    -- exclude if already returned via path A
    AND NOT EXISTS (
      SELECT 1
      FROM public.organization_members m2
      JOIN public.organizations o2 ON o2.id = m2.organization_id
      WHERE m2.user_id = auth.uid()
        AND o2.agency_id = p_agency_id
        AND o2.type = 'agency'
    )
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_my_agency_member_role(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_agency_member_role(uuid) TO authenticated;


-- =============================================================================
-- 2. conversation_accessible_to_me
--    Erweitert um Booker-Pfad für agency_organization_id:
--    Booker dürfen Gespräche lesen, wenn ihre bookers.agency_id mit der
--    Agency hinter agency_organization_id übereinstimmt.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.conversation_accessible_to_me(p_conv_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.conversations c
    WHERE c.id = p_conv_id
      AND (
        -- Pfad 1: direkter Teilnehmer
        auth.uid() = ANY (c.participant_ids)

        -- Pfad 2: Mitglied der Client-Organisation
        OR (
          c.client_organization_id IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM public.organization_members m
            WHERE m.organization_id = c.client_organization_id
              AND m.user_id = auth.uid()
          )
        )

        -- Pfad 3: Mitglied der Agency-Organisation (via organization_members)
        OR (
          c.agency_organization_id IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM public.organization_members m
            WHERE m.organization_id = c.agency_organization_id
              AND m.user_id = auth.uid()
          )
        )

        -- Pfad 4: Booker der Agentur hinter agency_organization_id
        OR (
          c.agency_organization_id IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM public.bookers bk
            JOIN public.organizations o
              ON o.agency_id = bk.agency_id AND o.type = 'agency'
            WHERE bk.user_id = auth.uid()
              AND o.id = c.agency_organization_id
          )
        )
      )
  );
$$;

REVOKE ALL ON FUNCTION public.conversation_accessible_to_me(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.conversation_accessible_to_me(uuid) TO authenticated;


-- =============================================================================
-- 3. Models RLS — Booker-Pfad hinzufügen
--    Jedes der drei Policies (SELECT, UPDATE, INSERT) bekommt einen dritten
--    OR-Zweig: bookers.user_id = auth.uid() AND bookers.agency_id = models.agency_id
-- =============================================================================

-- ── SELECT ────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Agency owner or member can read agency models" ON public.models;

CREATE POLICY "Agency owner or member can read agency models"
  ON public.models FOR SELECT
  TO authenticated
  USING (
    -- Pfad A: via organizations (owner oder organization_members)
    EXISTS (
      SELECT 1
      FROM public.organizations o
      WHERE o.type      = 'agency'
        AND o.agency_id = models.agency_id
        AND (
          o.owner_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.organization_members om
            WHERE om.organization_id = o.id
              AND om.user_id = auth.uid()
              AND om.role IN ('owner', 'booker')
          )
        )
    )
    -- Pfad B: direkter Booker-Eintrag
    OR EXISTS (
      SELECT 1 FROM public.bookers b
      WHERE b.user_id   = auth.uid()
        AND b.agency_id = models.agency_id
    )
  );

-- ── UPDATE ────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Agency owner or member can update model" ON public.models;

CREATE POLICY "Agency owner or member can update model"
  ON public.models FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.organizations o
      WHERE o.type      = 'agency'
        AND o.agency_id = models.agency_id
        AND (
          o.owner_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.organization_members om
            WHERE om.organization_id = o.id
              AND om.user_id = auth.uid()
              AND om.role IN ('owner', 'booker')
          )
        )
    )
    OR EXISTS (
      SELECT 1 FROM public.bookers b
      WHERE b.user_id = auth.uid() AND b.agency_id = models.agency_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.organizations o
      WHERE o.type      = 'agency'
        AND o.agency_id = models.agency_id
        AND (
          o.owner_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.organization_members om
            WHERE om.organization_id = o.id
              AND om.user_id = auth.uid()
              AND om.role IN ('owner', 'booker')
          )
        )
    )
    OR EXISTS (
      SELECT 1 FROM public.bookers b
      WHERE b.user_id = auth.uid() AND b.agency_id = models.agency_id
    )
  );

-- ── INSERT ────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Agency owner or member can insert model" ON public.models;

CREATE POLICY "Agency owner or member can insert model"
  ON public.models FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.organizations o
      WHERE o.type      = 'agency'
        AND o.agency_id = models.agency_id
        AND (
          o.owner_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.organization_members om
            WHERE om.organization_id = o.id
              AND om.user_id = auth.uid()
              AND om.role IN ('owner', 'booker')
          )
        )
    )
    OR EXISTS (
      SELECT 1 FROM public.bookers b
      WHERE b.user_id = auth.uid() AND b.agency_id = models.agency_id
    )
  );


-- =============================================================================
-- 4. create_b2b_org_conversation RPC
--    Booker dürfen B2B-Conversations erstellen, wenn sie in bookers für die
--    Agentur hinter p_agency_org_id eingetragen sind.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.create_b2b_org_conversation(
  p_context_id text,
  p_client_org_id uuid,
  p_agency_org_id uuid,
  p_participant_ids uuid[],
  p_title text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_existing uuid;
  v_new_id uuid;
  v_parts uuid[] := COALESCE(p_participant_ids, ARRAY[]::uuid[]);
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  IF p_client_org_id IS NULL OR p_agency_org_id IS NULL OR p_context_id IS NULL OR length(trim(p_context_id)) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_params');
  END IF;

  IF p_context_id NOT LIKE 'b2b:%' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_context');
  END IF;

  -- Caller must belong to at least one side of the pair.
  -- Prüft: organization_members ODER Booker-Tabelle (für Agency-Seite).
  IF NOT (
    EXISTS (
      SELECT 1
      FROM public.organization_members m
      WHERE m.user_id = v_uid
        AND (m.organization_id = p_client_org_id OR m.organization_id = p_agency_org_id)
    )
    OR EXISTS (
      SELECT 1
      FROM public.bookers bk
      JOIN public.organizations o ON o.agency_id = bk.agency_id AND o.type = 'agency'
      WHERE bk.user_id = v_uid
        AND o.id = p_agency_org_id
    )
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_org_member');
  END IF;

  IF NOT (v_uid = ANY (v_parts)) THEN
    v_parts := array_append(v_parts, v_uid);
  END IF;

  SELECT c.id INTO v_existing
  FROM public.conversations c
  WHERE c.type = 'direct'::conversation_type
    AND c.context_id = p_context_id
  LIMIT 1;

  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'conversation_id', v_existing, 'created', false);
  END IF;

  BEGIN
    INSERT INTO public.conversations (
      type,
      context_id,
      participant_ids,
      title,
      created_by,
      client_organization_id,
      agency_organization_id
    ) VALUES (
      'direct'::conversation_type,
      p_context_id,
      v_parts,
      COALESCE(NULLIF(trim(p_title), ''), 'Client ↔ Agency'),
      v_uid,
      p_client_org_id,
      p_agency_org_id
    )
    RETURNING id INTO v_new_id;

    RETURN jsonb_build_object('ok', true, 'conversation_id', v_new_id, 'created', true);
  EXCEPTION
    WHEN unique_violation THEN
      SELECT c.id INTO v_existing
      FROM public.conversations c
      WHERE c.type = 'direct'::conversation_type
        AND c.context_id = p_context_id
      LIMIT 1;
      IF v_existing IS NOT NULL THEN
        RETURN jsonb_build_object('ok', true, 'conversation_id', v_existing, 'created', false);
      END IF;
      RETURN jsonb_build_object('ok', false, 'error', 'unique_violation');
  END;
END;
$$;

ALTER FUNCTION public.create_b2b_org_conversation(text, uuid, uuid, uuid[], text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.create_b2b_org_conversation(text, uuid, uuid, uuid[], text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_b2b_org_conversation(text, uuid, uuid, uuid[], text) TO authenticated;
