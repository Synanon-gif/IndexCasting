-- =============================================================================
-- Mother-Agency Fields on public.models
-- Date: 2026-12-03
--
-- Adds two free-text columns to public.models so an Agency can record where a
-- model is "mother-represented" (i.e. another agency is the primary
-- representation, this Agency is a sub-agent / placement partner).
--
-- Why free-text (not a relational FK to public.agencies):
--   * The mother-agency is OFTEN an agency that is NOT on this platform
--     (or not yet onboarded). A FK would force a placeholder row per external
--     mother-agency and create a permanent management problem.
--   * Free text mirrors how this is handled today in spreadsheets and external
--     CRMs and matches the agency_internal mental model.
--   * Switching to a relational lookup later is a strict superset (we can
--     add an optional FK column without breaking the text columns).
--
-- Visibility / RLS:
--   * `mother_agency_name`     — visible to anyone who can read the model row
--                                (agency members + clients with an active
--                                territory + the model themself, all already
--                                enforced by existing models RLS).
--   * `mother_agency_contact`  — same RLS scope on the column itself, but the
--                                UI only renders it for agency members.
--                                Documented as agency-internal in
--                                .cursor/rules/mother-agency.mdc.
--   * Edit path: ONLY via agency_update_model_full RPC (Agency Owner / Booker).
--     Models / clients can NOT write these columns directly (no other RPC
--     touches them). Package importers MUST NOT auto-fill — see
--     .cursor/rules/package-import-invariants.mdc §I.
--
-- Idempotent: every step is guarded.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------

ALTER TABLE public.models
  ADD COLUMN IF NOT EXISTS mother_agency_name    text NULL;

ALTER TABLE public.models
  ADD COLUMN IF NOT EXISTS mother_agency_contact text NULL;

COMMENT ON COLUMN public.models.mother_agency_name IS
  'Free-text name of the mother agency that primarily represents this model. '
  'NULL = no mother agency / this agency is the primary representation. '
  'Editable via agency_update_model_full only. Visible to agency, model, and '
  'territory-paired clients (model RLS).';

COMMENT ON COLUMN public.models.mother_agency_contact IS
  'Free-text contact info (email, phone, booker name) for the mother agency. '
  'Same RLS as mother_agency_name on the column, but UI restricts display to '
  'agency members (agency-internal). NEVER auto-filled by package importers.';

-- ---------------------------------------------------------------------------
-- 2. agency_update_model_full — extend with mother-agency params
--
-- Strict superset of the 20260903 version: same body + 2 new optional params,
-- both COALESCE'd so existing callers stay binary-compatible (NULL = no change).
--
-- PostgreSQL: new parameters change the signature. CREATE OR REPLACE alone would
-- add a second overload; REVOKE/COMMENT then fail with 42725. Drop the prior
-- signature first (idempotent).
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.agency_update_model_full(
  uuid, text, text, text, text, text, text, text,
  integer, integer, integer, integer, integer, integer, integer,
  text, text, text, text, text[],
  boolean, boolean, boolean, boolean, boolean,
  text[], text[], text, text, boolean, text, timestamptz
);

CREATE OR REPLACE FUNCTION public.agency_update_model_full(
  p_model_id                     uuid,
  p_name                         text        DEFAULT NULL,
  p_email                        text        DEFAULT NULL,
  p_phone                        text        DEFAULT NULL,
  p_city                         text        DEFAULT NULL,
  p_country                      text        DEFAULT NULL,
  p_country_code                 text        DEFAULT NULL,
  p_current_location             text        DEFAULT NULL,
  p_height                       integer     DEFAULT NULL,
  p_bust                         integer     DEFAULT NULL,
  p_waist                        integer     DEFAULT NULL,
  p_hips                         integer     DEFAULT NULL,
  p_chest                        integer     DEFAULT NULL,
  p_legs_inseam                  integer     DEFAULT NULL,
  p_shoe_size                    integer     DEFAULT NULL,
  p_hair_color                   text        DEFAULT NULL,
  p_eye_color                    text        DEFAULT NULL,
  p_sex                          text        DEFAULT NULL,
  p_ethnicity                    text        DEFAULT NULL,
  p_categories                   text[]      DEFAULT NULL,
  p_is_visible_fashion           boolean     DEFAULT NULL,
  p_is_visible_commercial        boolean     DEFAULT NULL,
  p_is_active                    boolean     DEFAULT NULL,
  p_is_sports_winter             boolean     DEFAULT NULL,
  p_is_sports_summer             boolean     DEFAULT NULL,
  p_portfolio_images             text[]      DEFAULT NULL,
  p_polaroids                    text[]      DEFAULT NULL,
  p_video_url                    text        DEFAULT NULL,
  p_polas_source                 text        DEFAULT NULL,
  p_show_polas_on_profile        boolean     DEFAULT NULL,
  p_agency_relationship_status   text        DEFAULT NULL,
  p_agency_relationship_ended_at timestamptz DEFAULT NULL,
  -- 20261203: mother agency (free text, optional, agency-edit only)
  p_mother_agency_name           text        DEFAULT NULL,
  p_mother_agency_contact        text        DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_model_agency_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF p_agency_relationship_status = 'ended' THEN
    RAISE EXCEPTION 'use_agency_remove_model';
  END IF;

  SELECT agency_id INTO v_model_agency_id
  FROM public.models
  WHERE id = p_model_id;

  IF NOT public.is_current_user_admin() THEN
    IF v_model_agency_id IS NOT NULL THEN
      IF NOT (
        EXISTS (
          SELECT 1
          FROM public.organization_members om
          JOIN public.organizations o ON o.id = om.organization_id
          WHERE om.user_id = auth.uid()
            AND o.type = 'agency'
            AND o.agency_id = v_model_agency_id
        )
        OR EXISTS (
          SELECT 1 FROM public.bookers
          WHERE agency_id = v_model_agency_id AND user_id = auth.uid()
        )
      ) THEN
        RAISE EXCEPTION 'model_not_in_agency';
      END IF;
    ELSE
      IF NOT (
        EXISTS (
          SELECT 1
          FROM public.organization_members om
          JOIN public.organizations o ON o.id = om.organization_id
          WHERE om.user_id = auth.uid()
            AND o.type = 'agency'
        )
        OR EXISTS (
          SELECT 1 FROM public.bookers
          WHERE user_id = auth.uid()
        )
      ) THEN
        RAISE EXCEPTION 'not_in_any_agency';
      END IF;
    END IF;
  END IF;

  UPDATE public.models SET
    name                         = COALESCE(p_name,                         name),
    email                        = COALESCE(p_email,                        email),
    city                         = COALESCE(p_city,                         city),
    country                      = COALESCE(p_country,                      country),
    country_code                 = COALESCE(p_country_code,                 country_code),
    current_location             = COALESCE(p_current_location,             current_location),
    height                       = COALESCE(p_height,                       height),
    bust                         = COALESCE(p_bust,                         bust),
    waist                        = COALESCE(p_waist,                        waist),
    hips                         = COALESCE(p_hips,                         hips),
    chest                        = COALESCE(p_chest,                        chest),
    legs_inseam                  = COALESCE(p_legs_inseam,                  legs_inseam),
    shoe_size                    = COALESCE(p_shoe_size,                    shoe_size),
    hair_color                   = COALESCE(p_hair_color,                   hair_color),
    eye_color                    = COALESCE(p_eye_color,                    eye_color),
    sex                          = COALESCE(p_sex,                          sex),
    ethnicity                    = COALESCE(p_ethnicity,                    ethnicity),
    categories                   = COALESCE(p_categories,                   categories),
    is_visible_fashion           = COALESCE(p_is_visible_fashion,           is_visible_fashion),
    is_visible_commercial        = COALESCE(p_is_visible_commercial,        is_visible_commercial),
    is_active                    = COALESCE(p_is_active,                    is_active),
    is_sports_winter             = COALESCE(p_is_sports_winter,             is_sports_winter),
    is_sports_summer             = COALESCE(p_is_sports_summer,             is_sports_summer),
    portfolio_images             = COALESCE(p_portfolio_images,             portfolio_images),
    polaroids                    = COALESCE(p_polaroids,                    polaroids),
    video_url                    = COALESCE(p_video_url,                    video_url),
    polas_source                 = COALESCE(p_polas_source,                 polas_source),
    show_polas_on_profile        = COALESCE(p_show_polas_on_profile,        show_polas_on_profile),
    -- 20261203: mother agency. NULL = no change. Empty/whitespace = explicit clear
    -- (so the agency CAN remove a previously-set mother agency from the form).
    -- Non-empty = set / update.
    mother_agency_name           = CASE
      WHEN p_mother_agency_name IS NULL          THEN mother_agency_name
      WHEN btrim(p_mother_agency_name) = ''      THEN NULL
      ELSE btrim(p_mother_agency_name)
    END,
    mother_agency_contact        = CASE
      WHEN p_mother_agency_contact IS NULL       THEN mother_agency_contact
      WHEN btrim(p_mother_agency_contact) = ''   THEN NULL
      ELSE btrim(p_mother_agency_contact)
    END,
    agency_relationship_status   = COALESCE(p_agency_relationship_status,   agency_relationship_status),
    agency_relationship_ended_at = CASE
      WHEN p_agency_relationship_status IN ('active', 'pending_link') THEN NULL
      ELSE COALESCE(p_agency_relationship_ended_at, agency_relationship_ended_at)
    END
  WHERE id = p_model_id;
END;
$$;

REVOKE ALL ON FUNCTION public.agency_update_model_full(
  uuid, text, text, text, text, text, text, text,
  integer, integer, integer, integer, integer, integer, integer,
  text, text, text, text, text[],
  boolean, boolean, boolean, boolean, boolean,
  text[], text[], text, text, boolean, text, timestamptz,
  text, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.agency_update_model_full(
  uuid, text, text, text, text, text, text, text,
  integer, integer, integer, integer, integer, integer, integer,
  text, text, text, text, text[],
  boolean, boolean, boolean, boolean, boolean,
  text[], text[], text, text, boolean, text, timestamptz,
  text, text
) TO authenticated;

COMMENT ON FUNCTION public.agency_update_model_full(
  uuid, text, text, text, text, text, text, text,
  integer, integer, integer, integer, integer, integer, integer,
  text, text, text, text, text[],
  boolean, boolean, boolean, boolean, boolean,
  text[], text[], text, text, boolean, text, timestamptz,
  text, text
) IS
  'FIXED (20260429): model-scoped membership + admin bypass. '
  'FIXED (20260430): no models.phone column — p_phone accepted for compat, not written. '
  'FIXED (20260518): clear agency_relationship_ended_at when re-activating (status→active/pending_link). '
  'FIXED (20260903): p_agency_relationship_status=ended forbidden — use agency_remove_model. '
  'EXTENDED (20261203): p_mother_agency_name + p_mother_agency_contact (free-text, agency-edit only).';
