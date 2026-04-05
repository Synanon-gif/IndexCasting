-- =============================================================================
-- Phase C: RPCs auf model_assignments umstellen (Dual-Write + neue org-RPCs)
--
-- Strategie:
--   - save_model_territories, add_model_territories, bulk_*:
--       Dual-Write → schreiben in BEIDE Tabellen (Übergang)
--       Backward-Compat bleibt erhalten
--
--   - Neue org-zentrische RPCs:
--       save_model_assignments(p_model_id, p_organization_id, p_country_codes, p_role)
--       add_model_assignments(...)
--       get_assignments_for_agency_roster(p_organization_id)
--       get_assignments_for_model(p_model_id, p_organization_id)
--
--   - get_models_by_location: JOIN auf model_assignments + organizations
--       (statt model_agency_territories + agencies)
--       Rückgabefelder bleiben identisch für Frontend-Kompatibilität.
--
-- SECURITY DEFINER + SET row_security TO off — kein Rekursionszyklus.
-- Idempotent — safe to run multiple times.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) save_model_territories — Dual-Write (model_agency_territories + model_assignments)
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.save_model_territories(UUID, UUID, TEXT[]);

CREATE OR REPLACE FUNCTION public.save_model_territories(
  p_model_id      UUID,
  p_agency_id     UUID,
  p_country_codes TEXT[]
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_uid           UUID    := auth.uid();
  v_authorized    BOOLEAN := FALSE;
  v_org_id        UUID;
  v_code          TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Autorisierung via Org-Mitgliedschaft (owner_id oder org_member)
  SELECT EXISTS (
    SELECT 1 FROM organizations o
    WHERE o.type      = 'agency'
      AND o.agency_id = p_agency_id
      AND o.owner_id  = v_uid
  ) INTO v_authorized;

  IF NOT v_authorized THEN
    SELECT EXISTS (
      SELECT 1 FROM organizations o
      JOIN organization_members om ON om.organization_id = o.id
      WHERE o.type      = 'agency'
        AND o.agency_id = p_agency_id
        AND om.user_id  = v_uid
        AND om.role     IN ('owner', 'booker')
    ) INTO v_authorized;
  END IF;

  IF NOT v_authorized THEN
    RAISE EXCEPTION 'Not authorized to manage territories for agency %', p_agency_id;
  END IF;

  -- Organisation-ID für model_assignments ermitteln
  SELECT id INTO v_org_id
  FROM organizations
  WHERE type      = 'agency'
    AND agency_id = p_agency_id
  ORDER BY created_at ASC
  LIMIT 1;

  -- legacy: model_agency_territories leeren für dieses (model, agency) Paar
  DELETE FROM model_agency_territories t
  WHERE t.model_id  = p_model_id
    AND t.agency_id = p_agency_id;

  -- model_assignments leeren für dieses (model, org) Paar
  IF v_org_id IS NOT NULL THEN
    DELETE FROM model_assignments ma
    WHERE ma.model_id        = p_model_id
      AND ma.organization_id = v_org_id;
  END IF;

  -- Neue Einträge einfügen
  IF p_country_codes IS NOT NULL THEN
    FOREACH v_code IN ARRAY p_country_codes LOOP
      v_code := UPPER(TRIM(v_code));
      CONTINUE WHEN v_code = '';

      -- legacy
      INSERT INTO model_agency_territories (model_id, agency_id, country_code, territory)
      VALUES (p_model_id, p_agency_id, v_code, v_code)
      ON CONFLICT ON CONSTRAINT model_agency_territories_unique_model_country
      DO UPDATE SET agency_id = EXCLUDED.agency_id,
                    territory  = EXCLUDED.territory;

      -- neu
      IF v_org_id IS NOT NULL THEN
        INSERT INTO model_assignments (model_id, organization_id, territory, role)
        VALUES (p_model_id, v_org_id, v_code, 'non_exclusive')
        ON CONFLICT ON CONSTRAINT model_assignments_unique_model_territory
        DO UPDATE SET organization_id = EXCLUDED.organization_id,
                      role            = EXCLUDED.role;
      END IF;
    END LOOP;
  END IF;

  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.save_model_territories(UUID, UUID, TEXT[]) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2) add_model_territories — Dual-Write (additiv)
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.add_model_territories(UUID, UUID, TEXT[]);

CREATE OR REPLACE FUNCTION public.add_model_territories(
  p_model_id      UUID,
  p_agency_id     UUID,
  p_country_codes TEXT[]
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_uid        UUID    := auth.uid();
  v_authorized BOOLEAN := FALSE;
  v_org_id     UUID;
  v_code       TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM organizations o
    WHERE o.type      = 'agency'
      AND o.agency_id = p_agency_id
      AND o.owner_id  = v_uid
  ) INTO v_authorized;

  IF NOT v_authorized THEN
    SELECT EXISTS (
      SELECT 1 FROM organizations o
      JOIN organization_members om ON om.organization_id = o.id
      WHERE o.type      = 'agency'
        AND o.agency_id = p_agency_id
        AND om.user_id  = v_uid
        AND om.role     IN ('owner', 'booker')
    ) INTO v_authorized;
  END IF;

  IF NOT v_authorized THEN
    RAISE EXCEPTION 'Not authorized to manage territories for agency %', p_agency_id;
  END IF;

  SELECT id INTO v_org_id
  FROM organizations
  WHERE type      = 'agency'
    AND agency_id = p_agency_id
  ORDER BY created_at ASC
  LIMIT 1;

  IF p_country_codes IS NOT NULL THEN
    FOREACH v_code IN ARRAY p_country_codes LOOP
      v_code := UPPER(TRIM(v_code));
      CONTINUE WHEN v_code = '';

      INSERT INTO model_agency_territories (model_id, agency_id, country_code, territory)
      VALUES (p_model_id, p_agency_id, v_code, v_code)
      ON CONFLICT ON CONSTRAINT model_agency_territories_unique_model_country
      DO UPDATE SET agency_id = EXCLUDED.agency_id,
                    territory  = EXCLUDED.territory;

      IF v_org_id IS NOT NULL THEN
        INSERT INTO model_assignments (model_id, organization_id, territory, role)
        VALUES (p_model_id, v_org_id, v_code, 'non_exclusive')
        ON CONFLICT ON CONSTRAINT model_assignments_unique_model_territory
        DO UPDATE SET organization_id = EXCLUDED.organization_id;
      END IF;
    END LOOP;
  END IF;

  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.add_model_territories(UUID, UUID, TEXT[]) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3) bulk_add_model_territories — Dual-Write
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bulk_add_model_territories(
  p_model_ids     uuid[],
  p_agency_id     uuid,
  p_country_codes text[]
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_normalized text[];
  v_org_id     uuid;
BEGIN
  SELECT ARRAY(
    SELECT DISTINCT upper(trim(c))
    FROM unnest(p_country_codes) AS c
    WHERE trim(c) <> ''
  ) INTO v_normalized;

  IF array_length(v_normalized, 1) IS NULL OR array_length(p_model_ids, 1) IS NULL THEN
    RETURN TRUE;
  END IF;

  SELECT id INTO v_org_id
  FROM organizations
  WHERE type      = 'agency'
    AND agency_id = p_agency_id
  ORDER BY created_at ASC
  LIMIT 1;

  -- legacy dual-write
  INSERT INTO model_agency_territories (model_id, agency_id, country_code, territory)
  SELECT m.id, p_agency_id, c.code, c.code
  FROM unnest(p_model_ids)       AS m(id)
  CROSS JOIN unnest(v_normalized) AS c(code)
  ON CONFLICT ON CONSTRAINT model_agency_territories_unique_model_country
  DO UPDATE SET agency_id = EXCLUDED.agency_id,
                territory  = EXCLUDED.territory;

  IF v_org_id IS NOT NULL THEN
    INSERT INTO model_assignments (model_id, organization_id, territory, role)
    SELECT m.id, v_org_id, c.code, 'non_exclusive'
    FROM unnest(p_model_ids)       AS m(id)
    CROSS JOIN unnest(v_normalized) AS c(code)
    ON CONFLICT ON CONSTRAINT model_assignments_unique_model_territory
    DO UPDATE SET organization_id = EXCLUDED.organization_id;
  END IF;

  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.bulk_add_model_territories(uuid[], uuid, text[]) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4) bulk_save_model_territories — Dual-Write (replace)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bulk_save_model_territories(
  p_model_ids     uuid[],
  p_agency_id     uuid,
  p_country_codes text[]
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_normalized text[];
  v_org_id     uuid;
BEGIN
  SELECT ARRAY(
    SELECT DISTINCT upper(trim(c))
    FROM unnest(p_country_codes) AS c
    WHERE trim(c) <> ''
  ) INTO v_normalized;

  IF array_length(p_model_ids, 1) IS NULL THEN
    RETURN TRUE;
  END IF;

  SELECT id INTO v_org_id
  FROM organizations
  WHERE type      = 'agency'
    AND agency_id = p_agency_id
  ORDER BY created_at ASC
  LIMIT 1;

  -- legacy: delete + insert
  DELETE FROM model_agency_territories t
  WHERE t.model_id  = ANY(p_model_ids)
    AND t.agency_id = p_agency_id;

  IF v_org_id IS NOT NULL THEN
    DELETE FROM model_assignments ma
    WHERE ma.model_id        = ANY(p_model_ids)
      AND ma.organization_id = v_org_id;
  END IF;

  IF array_length(v_normalized, 1) IS NOT NULL THEN
    INSERT INTO model_agency_territories (model_id, agency_id, country_code, territory)
    SELECT m.id, p_agency_id, c.code, c.code
    FROM unnest(p_model_ids)       AS m(id)
    CROSS JOIN unnest(v_normalized) AS c(code)
    ON CONFLICT ON CONSTRAINT model_agency_territories_unique_model_country
    DO UPDATE SET agency_id = EXCLUDED.agency_id,
                  territory  = EXCLUDED.territory;

    IF v_org_id IS NOT NULL THEN
      INSERT INTO model_assignments (model_id, organization_id, territory, role)
      SELECT m.id, v_org_id, c.code, 'non_exclusive'
      FROM unnest(p_model_ids)       AS m(id)
      CROSS JOIN unnest(v_normalized) AS c(code)
      ON CONFLICT ON CONSTRAINT model_assignments_unique_model_territory
      DO UPDATE SET organization_id = EXCLUDED.organization_id;
    END IF;
  END IF;

  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.bulk_save_model_territories(uuid[], uuid, text[]) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5) NEUE RPCs: org-zentrisch (organization_id statt agency_id)
-- ---------------------------------------------------------------------------

-- 5a) save_model_assignments — vollständiger Replace für (model, org) Paar
CREATE OR REPLACE FUNCTION public.save_model_assignments(
  p_model_id      UUID,
  p_organization_id UUID,
  p_country_codes TEXT[],
  p_role          public.assignment_role DEFAULT 'non_exclusive'
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_uid        UUID    := auth.uid();
  v_authorized BOOLEAN := FALSE;
  v_agency_id  UUID;
  v_code       TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Org muss vom Typ 'agency' sein
  IF NOT EXISTS (
    SELECT 1 FROM organizations o
    WHERE o.id   = p_organization_id
      AND o.type = 'agency'
  ) THEN
    RAISE EXCEPTION 'organization_not_an_agency';
  END IF;

  -- Autorisierung via Org-Mitgliedschaft
  SELECT EXISTS (
    SELECT 1 FROM organizations o
    WHERE o.id       = p_organization_id
      AND o.owner_id = v_uid
  ) INTO v_authorized;

  IF NOT v_authorized THEN
    SELECT EXISTS (
      SELECT 1 FROM organization_members om
      WHERE om.organization_id = p_organization_id
        AND om.user_id         = v_uid
        AND om.role            IN ('owner', 'booker')
    ) INTO v_authorized;
  END IF;

  IF NOT v_authorized THEN
    RAISE EXCEPTION 'Not authorized to manage assignments for organization %', p_organization_id;
  END IF;

  -- agency_id für legacy dual-write
  SELECT agency_id INTO v_agency_id
  FROM organizations WHERE id = p_organization_id;

  -- Bestehende Einträge löschen
  DELETE FROM model_assignments ma
  WHERE ma.model_id        = p_model_id
    AND ma.organization_id = p_organization_id;

  IF v_agency_id IS NOT NULL THEN
    DELETE FROM model_agency_territories t
    WHERE t.model_id  = p_model_id
      AND t.agency_id = v_agency_id;
  END IF;

  -- Neu einfügen
  IF p_country_codes IS NOT NULL THEN
    FOREACH v_code IN ARRAY p_country_codes LOOP
      v_code := UPPER(TRIM(v_code));
      CONTINUE WHEN v_code = '';

      INSERT INTO model_assignments (model_id, organization_id, territory, role)
      VALUES (p_model_id, p_organization_id, v_code, p_role)
      ON CONFLICT ON CONSTRAINT model_assignments_unique_model_territory
      DO UPDATE SET organization_id = EXCLUDED.organization_id,
                    role            = EXCLUDED.role;

      IF v_agency_id IS NOT NULL THEN
        INSERT INTO model_agency_territories (model_id, agency_id, country_code, territory)
        VALUES (p_model_id, v_agency_id, v_code, v_code)
        ON CONFLICT ON CONSTRAINT model_agency_territories_unique_model_country
        DO UPDATE SET agency_id = EXCLUDED.agency_id,
                      territory  = EXCLUDED.territory;
      END IF;
    END LOOP;
  END IF;

  RETURN TRUE;
END;
$$;

REVOKE ALL    ON FUNCTION public.save_model_assignments(UUID, UUID, TEXT[], public.assignment_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_model_assignments(UUID, UUID, TEXT[], public.assignment_role) TO authenticated;

-- 5b) add_model_assignments — additiv (preserviert bestehende Territories)
CREATE OR REPLACE FUNCTION public.add_model_assignments(
  p_model_id        UUID,
  p_organization_id UUID,
  p_country_codes   TEXT[],
  p_role            public.assignment_role DEFAULT 'non_exclusive'
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_uid        UUID    := auth.uid();
  v_authorized BOOLEAN := FALSE;
  v_agency_id  UUID;
  v_code       TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM organizations o
    WHERE o.id = p_organization_id AND o.type = 'agency'
  ) THEN
    RAISE EXCEPTION 'organization_not_an_agency';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM organizations o
    WHERE o.id = p_organization_id AND o.owner_id = v_uid
  ) INTO v_authorized;

  IF NOT v_authorized THEN
    SELECT EXISTS (
      SELECT 1 FROM organization_members om
      WHERE om.organization_id = p_organization_id
        AND om.user_id = v_uid AND om.role IN ('owner', 'booker')
    ) INTO v_authorized;
  END IF;

  IF NOT v_authorized THEN
    RAISE EXCEPTION 'Not authorized for organization %', p_organization_id;
  END IF;

  SELECT agency_id INTO v_agency_id
  FROM organizations WHERE id = p_organization_id;

  IF p_country_codes IS NOT NULL THEN
    FOREACH v_code IN ARRAY p_country_codes LOOP
      v_code := UPPER(TRIM(v_code));
      CONTINUE WHEN v_code = '';

      INSERT INTO model_assignments (model_id, organization_id, territory, role)
      VALUES (p_model_id, p_organization_id, v_code, p_role)
      ON CONFLICT ON CONSTRAINT model_assignments_unique_model_territory
      DO UPDATE SET organization_id = EXCLUDED.organization_id,
                    role            = EXCLUDED.role;

      IF v_agency_id IS NOT NULL THEN
        INSERT INTO model_agency_territories (model_id, agency_id, country_code, territory)
        VALUES (p_model_id, v_agency_id, v_code, v_code)
        ON CONFLICT ON CONSTRAINT model_agency_territories_unique_model_country
        DO UPDATE SET agency_id = EXCLUDED.agency_id,
                      territory  = EXCLUDED.territory;
      END IF;
    END LOOP;
  END IF;

  RETURN TRUE;
END;
$$;

REVOKE ALL    ON FUNCTION public.add_model_assignments(UUID, UUID, TEXT[], public.assignment_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_model_assignments(UUID, UUID, TEXT[], public.assignment_role) TO authenticated;

-- 5c) get_assignments_for_agency_roster — org-zentrisch (analog zu get_territories_for_agency_roster)
DROP FUNCTION IF EXISTS public.get_assignments_for_agency_roster(UUID);

CREATE OR REPLACE FUNCTION public.get_assignments_for_agency_roster(
  p_organization_id UUID
)
RETURNS TABLE(
  r_model_id        UUID,
  r_territory       TEXT,
  r_role            public.assignment_role
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
  SELECT ma.model_id, ma.territory, ma.role
  FROM   model_assignments ma
  WHERE  ma.organization_id = p_organization_id
  ORDER  BY ma.territory;
$$;

REVOKE ALL    ON FUNCTION public.get_assignments_for_agency_roster(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_assignments_for_agency_roster(UUID) TO authenticated;

-- 5d) get_assignments_for_model — org-zentrisch (analog zu get_territories_for_model)
DROP FUNCTION IF EXISTS public.get_assignments_for_model(UUID, UUID);

CREATE OR REPLACE FUNCTION public.get_assignments_for_model(
  p_model_id        UUID,
  p_organization_id UUID DEFAULT NULL
)
RETURNS TABLE(
  r_id              UUID,
  r_model_id        UUID,
  r_organization_id UUID,
  r_territory       TEXT,
  r_role            public.assignment_role,
  r_created_at      TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
  SELECT ma.id, ma.model_id, ma.organization_id, ma.territory, ma.role, ma.created_at
  FROM   model_assignments ma
  WHERE  ma.model_id = p_model_id
    AND  (p_organization_id IS NULL OR ma.organization_id = p_organization_id)
  ORDER  BY ma.territory;
$$;

REVOKE ALL    ON FUNCTION public.get_assignments_for_model(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_assignments_for_model(UUID, UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- 6) get_models_by_location — JOIN auf model_assignments + organizations
--    Rückgabefelder bleiben identisch (territory_country_code, agency_name,
--    territory_agency_id) für Frontend-Kompatibilität.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_models_by_location(
  p_iso             text,
  p_client_type     text      DEFAULT 'all',
  p_from            integer   DEFAULT 0,
  p_to              integer   DEFAULT 999,
  p_city            text      DEFAULT NULL,
  p_category        text      DEFAULT NULL,
  p_sports_winter   boolean   DEFAULT FALSE,
  p_sports_summer   boolean   DEFAULT FALSE,
  p_height_min      integer   DEFAULT NULL,
  p_height_max      integer   DEFAULT NULL,
  p_hair_color      text      DEFAULT NULL,
  p_hips_min        integer   DEFAULT NULL,
  p_hips_max        integer   DEFAULT NULL,
  p_waist_min       integer   DEFAULT NULL,
  p_waist_max       integer   DEFAULT NULL,
  p_chest_min       integer   DEFAULT NULL,
  p_chest_max       integer   DEFAULT NULL,
  p_legs_inseam_min integer   DEFAULT NULL,
  p_legs_inseam_max integer   DEFAULT NULL,
  p_sex             text      DEFAULT NULL,
  p_ethnicities     text[]    DEFAULT NULL
)
RETURNS SETOF jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF auth.role() = 'authenticated' THEN
    IF NOT public.has_platform_access() THEN
      RAISE EXCEPTION 'platform_access_denied'
        USING HINT    = 'Active subscription or trial required to discover models.',
              ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN QUERY
  SELECT to_jsonb(result)
  FROM (
    SELECT
      m.id,
      m.name,
      m.city,
      m.country,
      m.country_code,
      m.current_location,
      m.height,
      m.bust,
      m.waist,
      m.hips,
      m.chest,
      m.legs_inseam,
      m.shoe_size,
      m.hair_color,
      m.eye_color,
      m.sex,
      m.ethnicity,
      m.categories,
      m.is_visible_fashion,
      m.is_visible_commercial,
      m.is_active,
      m.is_sports_winter,
      m.is_sports_summer,
      m.portfolio_images,
      m.polaroids,
      m.video_url,
      m.polas_source,
      m.show_polas_on_profile,
      m.agency_id,
      m.agency_relationship_status,
      m.user_id,
      m.created_at,
      m.updated_at,
      -- Neue Felder aus model_assignments + organizations
      ma.territory        AS territory_country_code,
      o.name              AS agency_name,
      -- territory_agency_id: organisations.agency_id für Legacy-Frontend-Kompatibilität
      o.agency_id         AS territory_agency_id,
      -- Neu: organization_id direkt verfügbar
      ma.organization_id  AS territory_organization_id,
      ma.role             AS assignment_role
    FROM public.models m
    JOIN public.model_assignments ma  ON ma.model_id = m.id
    JOIN public.organizations     o   ON o.id        = ma.organization_id
    WHERE
      ma.territory = UPPER(TRIM(p_iso))
      AND m.is_active = TRUE
      AND (
        m.agency_relationship_status IS NULL
        OR m.agency_relationship_status IN ('active', 'pending_link')
      )
      AND (
        p_client_type = 'all'
        OR (p_client_type = 'fashion'    AND m.is_visible_fashion    = TRUE)
        OR (p_client_type = 'commercial' AND m.is_visible_commercial = TRUE)
      )
      AND (NOT p_sports_winter OR m.is_sports_winter = TRUE)
      AND (NOT p_sports_summer OR m.is_sports_summer = TRUE)
      AND (p_height_min      IS NULL OR m.height      >= p_height_min)
      AND (p_height_max      IS NULL OR m.height      <= p_height_max)
      AND (p_hips_min        IS NULL OR m.hips        >= p_hips_min)
      AND (p_hips_max        IS NULL OR m.hips        <= p_hips_max)
      AND (p_waist_min       IS NULL OR m.waist       >= p_waist_min)
      AND (p_waist_max       IS NULL OR m.waist       <= p_waist_max)
      AND (p_chest_min       IS NULL OR m.chest       >= p_chest_min)
      AND (p_chest_max       IS NULL OR m.chest       <= p_chest_max)
      AND (p_legs_inseam_min IS NULL OR m.legs_inseam >= p_legs_inseam_min)
      AND (p_legs_inseam_max IS NULL OR m.legs_inseam <= p_legs_inseam_max)
      AND (p_sex             IS NULL OR m.sex         =  p_sex)
      AND (
        p_hair_color IS NULL OR p_hair_color = ''
        OR m.hair_color ILIKE ('%' || p_hair_color || '%')
      )
      AND (
        p_city IS NULL OR p_city = ''
        OR m.city ILIKE p_city
      )
      AND (
        p_category IS NULL
        OR m.categories IS NULL
        OR m.categories = '{}'
        OR m.categories @> ARRAY[p_category]
      )
      AND (
        p_ethnicities IS NULL
        OR array_length(p_ethnicities, 1) IS NULL
        OR m.ethnicity = ANY(p_ethnicities)
      )
    ORDER BY m.name
    OFFSET p_from
    LIMIT  (p_to - p_from + 1)
  ) result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_models_by_location(
  text, text, integer, integer, text, text, boolean, boolean,
  integer, integer, text, integer, integer, integer, integer,
  integer, integer, integer, integer, text, text[]
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_models_by_location(
  text, text, integer, integer, text, text, boolean, boolean,
  integer, integer, text, integer, integer, integer, integer,
  integer, integer, integer, integer, text, text[]
) TO authenticated;

-- ---------------------------------------------------------------------------
-- 7) agency_claim_unowned_model — auch in model_assignments verankern
--    (kein Auto-Territory; setzt nur models.agency_id für backward compat)
--    Nach Phase F wird nur noch model_assignments relevant.
-- ---------------------------------------------------------------------------
-- Hinweis: agency_claim_unowned_model bleibt in dieser Phase wie bisher
-- (setzt models.agency_id). Territories werden separat via save_model_assignments
-- gesetzt. Kein Breaking Change.

-- ---------------------------------------------------------------------------
-- 8) Verifikation
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'save_model_assignments'
  ), 'save_model_assignments nicht gefunden';

  ASSERT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'add_model_assignments'
  ), 'add_model_assignments nicht gefunden';

  ASSERT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'get_assignments_for_agency_roster'
  ), 'get_assignments_for_agency_roster nicht gefunden';

  ASSERT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'get_assignments_for_model'
  ), 'get_assignments_for_model nicht gefunden';

  ASSERT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'get_models_by_location'
  ), 'get_models_by_location nicht gefunden';

  RAISE NOTICE 'migration_rpcs_model_assignments_v2: OK';
END $$;
