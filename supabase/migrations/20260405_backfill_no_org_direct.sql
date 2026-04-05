-- One-time direct backfill (runs as superuser via API, no auth.uid() required)
DO $$
DECLARE
  r       RECORD;
  v_aid   uuid;
  v_oid   uuid;
  v_code  text;
  v_cname text;
  v_fixed int := 0;
BEGIN
  FOR r IN
    SELECT p.id, p.email, p.company_name, p.role::text AS role
    FROM public.profiles p
    WHERE p.role::text IN ('agent', 'client')
      AND NOT EXISTS (
        SELECT 1 FROM public.organization_members m WHERE m.user_id = p.id
      )
  LOOP
    v_cname := r.company_name;

    IF r.role = 'client' THEN
      SELECT id INTO v_oid FROM public.organizations
      WHERE owner_id = r.id AND type = 'client' LIMIT 1;

      IF v_oid IS NULL THEN
        INSERT INTO public.organizations (name, type, owner_id, agency_id)
        VALUES (COALESCE(NULLIF(trim(v_cname), ''), 'My Organization'), 'client', r.id, NULL)
        RETURNING id INTO v_oid;
      END IF;

      INSERT INTO public.organization_members (user_id, organization_id, role)
      VALUES (r.id, v_oid, 'owner')
      ON CONFLICT (user_id, organization_id) DO NOTHING;
      v_fixed := v_fixed + 1;

    ELSIF r.role = 'agent' AND r.email IS NOT NULL AND trim(r.email) <> '' THEN
      SELECT id INTO v_aid FROM public.agencies
      WHERE lower(trim(email)) = lower(trim(r.email)) LIMIT 1;

      IF v_aid IS NULL THEN
        v_code := 'a' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 15);
        INSERT INTO public.agencies (name, email, code)
        VALUES (COALESCE(NULLIF(trim(v_cname), ''), 'Agency'), r.email, v_code)
        RETURNING id INTO v_aid;
      END IF;

      SELECT id INTO v_oid FROM public.organizations
      WHERE agency_id = v_aid LIMIT 1;

      IF v_oid IS NULL THEN
        INSERT INTO public.organizations (name, type, owner_id, agency_id)
        VALUES (COALESCE(NULLIF(trim(v_cname), ''), 'Agency'), 'agency', r.id, v_aid)
        RETURNING id INTO v_oid;
      END IF;

      INSERT INTO public.organization_members (user_id, organization_id, role)
      VALUES (r.id, v_oid, 'owner')
      ON CONFLICT (user_id, organization_id) DO NOTHING;
      v_fixed := v_fixed + 1;
    END IF;
  END LOOP;

  RAISE NOTICE 'Backfill complete: % accounts fixed', v_fixed;
END;
$$;
