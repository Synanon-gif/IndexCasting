-- =============================================================================
-- 20261025_import_models_from_agency_share.sql
--
-- Agency-to-Agency Roster Share — recipient import RPC.
--
-- For each requested (model_id, country_codes[]) tuple:
--   * INSERT into public.model_agency_territories(model_id, agency_id, country_code)
--     where agency_id = recipient agency (caller's agency).
--   * ON CONFLICT (model_id, country_code) DO NOTHING — UNIQUE constraint
--     `model_agency_territories_one_agency_per_territory` (one agency per
--     territory) is preserved; conflicts are reported back to the caller.
--
-- Authorization:
--   * Caller must be authenticated.
--   * Caller must be a member of `p_organization_id` (recipient agency org).
--   * The share row (`guest_links.id = p_link_id`) must:
--       - have purpose = 'agency_share'
--       - target_agency_id = caller's agency
--       - is_active = true AND deleted_at IS NULL
--       - expires_at IS NULL OR expires_at > now()
--   * Every requested model_id MUST be in the share's `model_ids` array.
--
-- Models.agency_id (home agency) is NOT changed — sender remains data owner
-- per the `a_remains_owner` product decision. Recipient becomes a co-agency
-- via MAT only.
--
-- Returns jsonb:
--   {
--     "imported": [{ "model_id": uuid, "country_code": text }],
--     "skipped":  [{ "model_id": uuid, "country_code": text,
--                    "existing_agency_id": uuid }]
--   }
--
-- Idempotent function definition. Single migration; not deployed via root
-- supabase/*.sql.
-- =============================================================================

DROP FUNCTION IF EXISTS public.import_models_from_agency_share(uuid, uuid, jsonb);

CREATE OR REPLACE FUNCTION public.import_models_from_agency_share(
  p_organization_id uuid,
  p_link_id uuid,
  p_imports jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_caller            uuid;
  v_recipient_agency  uuid;
  v_share             public.guest_links%ROWTYPE;
  v_imported          jsonb := '[]'::jsonb;
  v_skipped           jsonb := '[]'::jsonb;
  v_request           jsonb;
  v_model_id          uuid;
  v_country_code      text;
  v_country_codes     text[];
  v_existing_agency   uuid;
  v_inserted          boolean;
BEGIN
  v_caller := auth.uid();
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'organization_id_required';
  END IF;

  IF p_link_id IS NULL THEN
    RAISE EXCEPTION 'link_id_required';
  END IF;

  IF p_imports IS NULL OR jsonb_typeof(p_imports) <> 'array' THEN
    RAISE EXCEPTION 'imports_required';
  END IF;

  -- 1) Recipient membership: caller must be member of p_organization_id (agency org)
  SELECT o.agency_id INTO v_recipient_agency
  FROM public.organization_members om
  JOIN public.organizations o ON o.id = om.organization_id
  WHERE om.user_id = v_caller
    AND om.organization_id = p_organization_id
    AND o.type = 'agency'
    AND o.agency_id IS NOT NULL;

  IF v_recipient_agency IS NULL THEN
    RAISE EXCEPTION 'not_member_of_recipient_organization';
  END IF;

  -- 2) Load and validate share row
  SELECT * INTO v_share
  FROM public.guest_links
  WHERE id = p_link_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'share_not_found';
  END IF;

  IF v_share.purpose IS DISTINCT FROM 'agency_share' THEN
    RAISE EXCEPTION 'share_wrong_purpose';
  END IF;

  IF v_share.target_agency_id IS DISTINCT FROM v_recipient_agency THEN
    RAISE EXCEPTION 'share_not_for_caller';
  END IF;

  IF v_share.is_active IS DISTINCT FROM true OR v_share.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'share_inactive';
  END IF;

  IF v_share.expires_at IS NOT NULL AND v_share.expires_at <= now() THEN
    RAISE EXCEPTION 'share_expired';
  END IF;

  -- 3) Iterate imports
  FOR v_request IN SELECT * FROM jsonb_array_elements(p_imports)
  LOOP
    BEGIN
      v_model_id := (v_request->>'model_id')::uuid;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'invalid_model_id_in_imports';
    END;

    IF v_model_id IS NULL THEN
      RAISE EXCEPTION 'model_id_required_in_imports';
    END IF;

    IF NOT (v_model_id = ANY (v_share.model_ids)) THEN
      RAISE EXCEPTION 'model_not_in_share' USING DETAIL = v_model_id::text;
    END IF;

    -- Extract country_codes array (text[])
    v_country_codes := ARRAY(
      SELECT upper(trim(value))
      FROM jsonb_array_elements_text(COALESCE(v_request->'country_codes', '[]'::jsonb))
      WHERE length(trim(value)) > 0
    );

    IF array_length(v_country_codes, 1) IS NULL THEN
      RAISE EXCEPTION 'country_codes_required_per_model' USING DETAIL = v_model_id::text;
    END IF;

    FOREACH v_country_code IN ARRAY v_country_codes
    LOOP
      v_existing_agency := NULL;
      v_inserted := false;

      INSERT INTO public.model_agency_territories (model_id, agency_id, country_code)
      VALUES (v_model_id, v_recipient_agency, v_country_code)
      ON CONFLICT (model_id, country_code) DO NOTHING
      RETURNING true INTO v_inserted;

      IF v_inserted IS TRUE THEN
        v_imported := v_imported || jsonb_build_object(
          'model_id', v_model_id,
          'country_code', v_country_code
        );
      ELSE
        SELECT mat.agency_id INTO v_existing_agency
        FROM public.model_agency_territories mat
        WHERE mat.model_id = v_model_id
          AND mat.country_code = v_country_code;

        v_skipped := v_skipped || jsonb_build_object(
          'model_id', v_model_id,
          'country_code', v_country_code,
          'existing_agency_id', v_existing_agency
        );
      END IF;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object(
    'imported', v_imported,
    'skipped',  v_skipped
  );
END;
$$;

REVOKE ALL ON FUNCTION public.import_models_from_agency_share(uuid, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_models_from_agency_share(uuid, uuid, jsonb) TO authenticated;

COMMENT ON FUNCTION public.import_models_from_agency_share(uuid, uuid, jsonb) IS
  'Agency-to-Agency Roster Share recipient RPC (20261025). Inserts model_agency_territories rows '
  'for the caller agency from a share package, with ON CONFLICT DO NOTHING + skipped reporting. '
  'models.agency_id (home agency) is preserved.';
