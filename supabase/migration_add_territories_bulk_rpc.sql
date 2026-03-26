-- =============================================================================
-- RPC: bulk_add_model_territories  +  bulk_save_model_territories
--
-- Ersetzt for-Schleifen in territoriesSupabase.ts:
--   bulkAddTerritoriesForModels:   N × add_model_territories RPC  → 1 Bulk-INSERT
--   bulkUpsertTerritoriesForModels: N × save_model_territories RPC → 1 Bulk-DELETE+INSERT
--
-- Vorher: 500 Modelle × 1 RPC = 500 seriell-sequentielle DB-Roundtrips.
-- Nachher: 1 RPC für alle Modelle.
--
-- Sicherheit: SECURITY DEFINER mit eigenem search_path (wie existierende Territory-RPCs).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. ADDITIVE Bulk-Zuweisung (ohne bestehende Territories zu entfernen)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bulk_add_model_territories(
  p_model_ids    uuid[],
  p_agency_id    uuid,
  p_country_codes text[]
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_normalized text[];
BEGIN
  -- Normalisiere Country-Codes zu Uppercase und dedupliziere
  SELECT ARRAY(
    SELECT DISTINCT upper(trim(c))
    FROM unnest(p_country_codes) AS c
    WHERE trim(c) <> ''
  ) INTO v_normalized;

  IF array_length(v_normalized, 1) IS NULL OR array_length(p_model_ids, 1) IS NULL THEN
    RETURN TRUE; -- nichts zu tun
  END IF;

  -- Kartesisches Produkt: jedes Modell × jeder Country-Code
  -- ON CONFLICT DO NOTHING = sicher idempotent
  INSERT INTO public.model_agency_territories (model_id, agency_id, country_code)
  SELECT m.id, p_agency_id, c.code
  FROM unnest(p_model_ids)       AS m(id)
  CROSS JOIN unnest(v_normalized) AS c(code)
  ON CONFLICT (model_id, agency_id, country_code) DO NOTHING;

  RETURN TRUE;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. REPLACE Bulk-Zuweisung (löscht bestehende Territories je Modell+Agentur
--    und ersetzt sie durch p_country_codes)
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
AS $$
DECLARE
  v_normalized text[];
BEGIN
  SELECT ARRAY(
    SELECT DISTINCT upper(trim(c))
    FROM unnest(p_country_codes) AS c
    WHERE trim(c) <> ''
  ) INTO v_normalized;

  IF array_length(p_model_ids, 1) IS NULL THEN
    RETURN TRUE;
  END IF;

  -- Lösche alle bestehenden Territories für diese Modelle + Agentur
  DELETE FROM public.model_agency_territories
  WHERE agency_id  = p_agency_id
    AND model_id   = ANY(p_model_ids);

  -- Neu einfügen (nur wenn Country-Codes vorhanden)
  IF array_length(v_normalized, 1) IS NOT NULL THEN
    INSERT INTO public.model_agency_territories (model_id, agency_id, country_code)
    SELECT m.id, p_agency_id, c.code
    FROM unnest(p_model_ids)        AS m(id)
    CROSS JOIN unnest(v_normalized) AS c(code)
    ON CONFLICT (model_id, agency_id, country_code) DO NOTHING;
  END IF;

  RETURN TRUE;
END;
$$;

-- Berechtigungen
GRANT EXECUTE ON FUNCTION public.bulk_add_model_territories(uuid[], uuid, text[])  TO authenticated;
GRANT EXECUTE ON FUNCTION public.bulk_save_model_territories(uuid[], uuid, text[]) TO authenticated;
