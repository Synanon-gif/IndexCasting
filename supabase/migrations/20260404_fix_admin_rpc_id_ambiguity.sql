-- Fix: "column reference id is ambiguous" in admin_list_organizations + admin_list_all_models
--
-- Both functions return TABLE(id UUID, ...). Inside PL/pgSQL functions with RETURNS TABLE,
-- output columns become implicit OUT variables. Writing "WHERE id = auth.uid()" inside
-- such a function is ambiguous: id could be the OUT variable or profiles.id.
-- Fix: use table alias "p" to qualify the profiles.id reference.

CREATE OR REPLACE FUNCTION public.admin_list_organizations()
RETURNS TABLE(
  id           UUID,
  name         TEXT,
  type         TEXT,
  owner_id     UUID,
  is_active    BOOLEAN,
  admin_notes  TEXT,
  member_count BIGINT,
  created_at   TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_admin = TRUE) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN QUERY
  SELECT
    o.id,
    o.name,
    o.type::text,
    o.owner_id,
    o.is_active,
    o.admin_notes,
    COUNT(m.user_id)::BIGINT AS member_count,
    o.created_at
  FROM public.organizations o
  LEFT JOIN public.organization_members m ON m.organization_id = o.id
  GROUP BY o.id, o.name, o.type, o.owner_id, o.is_active, o.admin_notes, o.created_at
  ORDER BY o.name;
END;
$$;

REVOKE ALL   ON FUNCTION public.admin_list_organizations() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_organizations() TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_list_all_models()
RETURNS TABLE(
  id          UUID,
  name        TEXT,
  email       TEXT,
  agency_id   UUID,
  user_id     UUID,
  is_active   BOOLEAN,
  admin_notes TEXT,
  created_at  TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_admin = TRUE) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN QUERY
  SELECT m.id, m.name, m.email, m.agency_id, m.user_id, m.is_active, m.admin_notes, m.created_at
  FROM public.models m
  ORDER BY m.name;
END;
$$;

REVOKE ALL   ON FUNCTION public.admin_list_all_models() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_all_models() TO authenticated;
