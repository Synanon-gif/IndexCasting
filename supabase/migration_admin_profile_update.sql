-- =============================================================================
-- Admin: Vollständiges Profil-Update per RPC (umgeht RLS, speichert zuverlässig)
-- Wenn der Admin bei einer Partei etwas ändert, wird es über diese Funktion
-- gespeichert und ist sofort in der DB sichtbar.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.admin_update_profile_full(
  target_id UUID,
  p_display_name TEXT DEFAULT NULL,
  p_email TEXT DEFAULT NULL,
  p_company_name TEXT DEFAULT NULL,
  p_phone TEXT DEFAULT NULL,
  p_website TEXT DEFAULT NULL,
  p_country TEXT DEFAULT NULL,
  p_role TEXT DEFAULT NULL,
  p_is_active BOOLEAN DEFAULT NULL,
  p_is_admin BOOLEAN DEFAULT NULL
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
  SET
    display_name = COALESCE(p_display_name, display_name),
    email = COALESCE(p_email, email),
    company_name = COALESCE(p_company_name, company_name),
    phone = COALESCE(p_phone, phone),
    website = COALESCE(p_website, website),
    country = COALESCE(p_country, country),
    role = COALESCE(p_role, role),
    is_active = COALESCE(p_is_active, is_active),
    is_admin = COALESCE(p_is_admin, is_admin),
    updated_at = now()
  WHERE id = target_id;

  INSERT INTO public.admin_logs (admin_id, action, target_user_id, details)
  VALUES (
    auth.uid(),
    'profile_edit',
    target_id,
    jsonb_build_object(
      'display_name', p_display_name, 'email', p_email, 'company_name', p_company_name,
      'phone', p_phone, 'website', p_website, 'country', p_country,
      'role', p_role, 'is_active', p_is_active, 'is_admin', p_is_admin
    )
  );

  RETURN true;
END;
$$;
