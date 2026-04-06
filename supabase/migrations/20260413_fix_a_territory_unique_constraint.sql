-- =============================================================================
-- Fix A: Territory Unique Constraint — One Agency per Territory per Model
--
-- PROBLEM:
--   Previous constraint UNIQUE (model_id, country_code, agency_id) allows
--   (model_A, DE, agency_1) AND (model_A, DE, agency_2) simultaneously.
--   This violates the system requirement: "A Model can only belong to ONE
--   agency per territory."
--
-- FIX:
--   1. Remove duplicate rows, keeping the oldest per (model_id, country_code).
--   2. Replace constraint with UNIQUE (model_id, country_code).
--   3. Recreate fn_transfer_pending_territories with:
--      - Correct ON CONFLICT target (model_id, country_code)
--      - SET row_security TO off (was missing — required for SECURITY DEFINER
--        that writes RLS-protected tables in PG15+)
--   4. Recreate create_model_from_accepted_application with correct ON CONFLICT.
--   5. Fix "Clients can view model territories" policy: replace direct
--      profiles.role='client' check with SECURITY DEFINER function
--      (caller_is_client_org_member, defined in Fix D migration — safe here
--       because we use check_org_access() which already exists).
--
-- Idempotent: safe to run multiple times.
-- =============================================================================

-- ─── 1. Resolve existing conflicts: keep oldest row per (model_id, country_code) ──

DELETE FROM public.model_agency_territories
WHERE id IN (
  SELECT id FROM (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY model_id, country_code
        ORDER BY created_at ASC NULLS LAST, id ASC
      ) AS rn
    FROM public.model_agency_territories
  ) ranked
  WHERE rn > 1
);

-- ─── 2. Drop all existing unique constraints on model_agency_territories ──────

DO $$
DECLARE
  v_conname text;
BEGIN
  FOR v_conname IN
    SELECT con.conname
    FROM pg_constraint con
    WHERE con.conrelid = 'public.model_agency_territories'::regclass
      AND con.contype = 'u'
  LOOP
    EXECUTE format('ALTER TABLE public.model_agency_territories DROP CONSTRAINT IF EXISTS %I', v_conname);
  END LOOP;
END $$;

-- ─── 3. Add correct constraint ────────────────────────────────────────────────

ALTER TABLE public.model_agency_territories
  ADD CONSTRAINT model_agency_territories_one_agency_per_territory
  UNIQUE (model_id, country_code);

-- Keep a plain index on agency_id for JOIN performance
CREATE INDEX IF NOT EXISTS idx_mat_agency_id ON public.model_agency_territories(agency_id);
CREATE INDEX IF NOT EXISTS idx_mat_model_id  ON public.model_agency_territories(model_id);

-- ─── 4. Recreate fn_transfer_pending_territories ─────────────────────────────
--
-- Changes from previous version:
--   a) SET row_security TO off — required; function writes model_agency_territories
--      in a SECURITY DEFINER trigger context (PG15+ latent recursion risk without it)
--   b) ON CONFLICT now targets (model_id, country_code) to match new constraint
--   c) ON CONFLICT DO UPDATE SET agency_id = EXCLUDED.agency_id — explicit: if a
--      territory is being confirmed by a model for a specific agency, that agency
--      wins for that territory (intent-based, not silent discard)

CREATE OR REPLACE FUNCTION public.fn_transfer_pending_territories()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off  -- required: writes RLS-protected table in trigger context
AS $$
DECLARE
  v_territory_code text;
  v_model_id       uuid;
  v_agency_id      uuid;
BEGIN
  -- Fire only when status transitions TO 'accepted' (not already accepted)
  IF NEW.status <> 'accepted' THEN
    RETURN NEW;
  END IF;
  IF OLD.status = 'accepted' THEN
    RETURN NEW;
  END IF;
  IF NEW.pending_territories IS NULL OR jsonb_array_length(NEW.pending_territories) = 0 THEN
    RETURN NEW;
  END IF;

  -- Find the model row created for this applicant + agency by create_model_from_accepted_application
  SELECT m.id, m.agency_id INTO v_model_id, v_agency_id
  FROM public.models m
  WHERE m.user_id   = NEW.applicant_user_id
    AND m.agency_id = NEW.accepted_by_agency_id
  ORDER BY m.created_at DESC
  LIMIT 1;

  IF v_model_id IS NULL THEN
    -- Model not yet created (timing edge-case). Territories will be written
    -- directly by create_model_from_accepted_application when it runs.
    RETURN NEW;
  END IF;

  -- Upsert each territory: if the territory is already taken by a DIFFERENT
  -- agency, that existing assignment is replaced (the accepting agency wins).
  FOR v_territory_code IN
    SELECT jsonb_array_elements_text(NEW.pending_territories)
  LOOP
    INSERT INTO public.model_agency_territories (model_id, agency_id, country_code, created_at)
    VALUES (v_model_id, v_agency_id, upper(trim(v_territory_code)), now())
    ON CONFLICT (model_id, country_code)
    DO UPDATE SET agency_id = EXCLUDED.agency_id;  -- accepting agency wins
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_transfer_pending_territories ON public.model_applications;

CREATE TRIGGER tr_transfer_pending_territories
  AFTER UPDATE OF status ON public.model_applications
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_transfer_pending_territories();

COMMENT ON FUNCTION public.fn_transfer_pending_territories() IS
  'Fix A (20260413): SET row_security TO off added; ON CONFLICT updated to '
  '(model_id, country_code) matching the new one-agency-per-territory constraint. '
  'DO UPDATE SET agency_id = EXCLUDED.agency_id — accepting agency wins on conflict.';

-- ─── 5. Recreate create_model_from_accepted_application ─────────────────────
--
-- Only the ON CONFLICT clause changes: (model_id, agency_id, country_code)
-- → (model_id, country_code).  All other logic is identical to 20260406 version.

CREATE OR REPLACE FUNCTION public.create_model_from_accepted_application(
  p_application_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_app            RECORD;
  v_existing_id    UUID;
  v_model_id       UUID;
  v_name           TEXT;
  v_imgs           TEXT[];
BEGIN
  -- GUARD 1: authenticated
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT * INTO v_app
  FROM model_applications
  WHERE id = p_application_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Application not found: %', p_application_id;
  END IF;

  -- GUARD 2: caller must be the applicant or an agency member
  IF v_app.applicant_user_id IS NOT NULL AND v_app.applicant_user_id <> auth.uid() THEN
    IF NOT EXISTS (
      SELECT 1 FROM organization_members om
      JOIN organizations o ON o.id = om.organization_id
      WHERE o.agency_id = v_app.accepted_by_agency_id
        AND om.user_id  = auth.uid()
    ) AND NOT EXISTS (
      SELECT 1 FROM bookers b
      WHERE b.agency_id = v_app.accepted_by_agency_id
        AND b.user_id   = auth.uid()
    ) THEN
      RAISE EXCEPTION 'Permission denied: caller is not the applicant or an agency member';
    END IF;
  END IF;

  IF v_app.status <> 'accepted' OR v_app.accepted_by_agency_id IS NULL THEN
    RAISE EXCEPTION 'Application is not accepted or missing agency: %', p_application_id;
  END IF;

  -- Idempotency: return existing model row if already created
  IF v_app.applicant_user_id IS NOT NULL THEN
    SELECT id INTO v_existing_id
    FROM models
    WHERE user_id = v_app.applicant_user_id
    LIMIT 1;
    IF v_existing_id IS NOT NULL THEN
      RETURN v_existing_id;
    END IF;
  END IF;

  v_name := trim(coalesce(v_app.first_name, '') || ' ' || coalesce(v_app.last_name, ''));
  IF v_name = '' THEN v_name := 'Model'; END IF;

  v_imgs := ARRAY(
    SELECT val::text
    FROM jsonb_each_text(coalesce(v_app.images, '{}'::jsonb)) AS t(key, val)
    WHERE key IN ('profile', 'fullBody', 'closeUp')
      AND val IS NOT NULL
  );

  INSERT INTO models (
    agency_id, user_id, agency_relationship_status, agency_relationship_ended_at,
    name, height, city, country_code, hair_color, ethnicity, sex,
    portfolio_images, polaroids, is_visible_commercial, is_visible_fashion, is_active
  ) VALUES (
    v_app.accepted_by_agency_id,
    v_app.applicant_user_id,
    'active', NULL,
    v_name,
    coalesce(v_app.height, 0),
    v_app.city,
    v_app.country_code,
    v_app.hair_color,
    v_app.ethnicity,
    CASE WHEN v_app.gender IN ('female', 'male') THEN v_app.gender::text ELSE NULL END,
    coalesce(v_imgs, ARRAY[]::text[]),
    ARRAY[]::text[],
    false, true, true
  )
  RETURNING id INTO v_model_id;

  IF array_length(v_imgs, 1) > 0 THEN
    INSERT INTO model_photos (
      model_id, url, sort_order, visible, is_visible_to_clients,
      photo_type, source, api_external_id
    )
    SELECT v_model_id, img, ord, true, true, 'portfolio', 'application', NULL
    FROM unnest(v_imgs) WITH ORDINALITY AS t(img, ord);
  END IF;

  -- Write territories from pending_territories.
  -- ON CONFLICT (model_id, country_code): the accepting agency wins.
  IF v_app.pending_territories IS NOT NULL AND jsonb_array_length(v_app.pending_territories) > 0 THEN
    INSERT INTO model_agency_territories (model_id, agency_id, country_code)
    SELECT
      v_model_id,
      v_app.accepted_by_agency_id,
      upper(trim(t.val))
    FROM jsonb_array_elements_text(v_app.pending_territories) AS t(val)
    WHERE trim(t.val) <> ''
    ON CONFLICT (model_id, country_code)
    DO UPDATE SET agency_id = EXCLUDED.agency_id;  -- accepting agency wins
  END IF;

  RETURN v_model_id;
END;
$$;

REVOKE ALL    ON FUNCTION public.create_model_from_accepted_application(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_model_from_accepted_application(UUID) TO authenticated;

COMMENT ON FUNCTION public.create_model_from_accepted_application IS
  'Fix A (20260413): ON CONFLICT updated to (model_id, country_code); '
  'DO UPDATE SET agency_id = EXCLUDED.agency_id; GUARD 1 (auth.uid() IS NULL) added.';

-- ─── 6. Fix "Clients can view model territories" policy ──────────────────────
--
-- Replace direct profiles.role = 'client' check with check_org_access()
-- which uses a SECURITY DEFINER function (row_security=off, recursion-safe).

DROP POLICY IF EXISTS "Clients can view model territories" ON public.model_agency_territories;

CREATE POLICY "clients_view_model_territories"
  ON public.model_agency_territories
  FOR SELECT
  TO authenticated
  USING (
    public.is_current_user_admin()
    OR EXISTS (
      SELECT 1
      FROM public.organization_members om
      JOIN public.organizations o ON o.id = om.organization_id
      WHERE om.user_id = auth.uid()
        AND o.type = 'client'
    )
    OR EXISTS (
      SELECT 1
      FROM public.organizations o
      WHERE o.owner_id = auth.uid()
        AND o.type = 'client'
    )
    OR EXISTS (
      -- Agency members can read territories of their own models
      SELECT 1
      FROM public.model_agency_territories self_mat
      JOIN public.organizations o ON o.agency_id = self_mat.agency_id
      JOIN public.organization_members om ON om.organization_id = o.id
      WHERE self_mat.id = model_agency_territories.id
        AND om.user_id = auth.uid()
    )
  );

-- ─── Verification ─────────────────────────────────────────────────────────────

DO $$
BEGIN
  -- Constraint must exist and reference only (model_id, country_code)
  ASSERT EXISTS (
    SELECT 1 FROM pg_constraint con
    WHERE con.conrelid = 'public.model_agency_territories'::regclass
      AND con.contype  = 'u'
      AND con.conname  = 'model_agency_territories_one_agency_per_territory'
  ), 'FAIL: model_agency_territories_one_agency_per_territory constraint not found';

  -- No duplicate (model_id, country_code) pairs should exist
  ASSERT NOT EXISTS (
    SELECT model_id, country_code
    FROM public.model_agency_territories
    GROUP BY model_id, country_code
    HAVING COUNT(*) > 1
  ), 'FAIL: duplicate (model_id, country_code) rows still exist';

  RAISE NOTICE 'PASS: 20260413_fix_a — territory constraint is UNIQUE(model_id, country_code), no duplicates';
END $$;
