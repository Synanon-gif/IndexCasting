-- AMI S. der Agentur Johannes@thepoetryofpeople.com zuordnen.
-- Legt die Agentur an, falls es noch keine mit dieser E-Mail gibt.
-- Einmal im Supabase SQL Editor ausführen.

DO $$
DECLARE
  aid uuid;
BEGIN
  SELECT id INTO aid FROM public.agencies WHERE LOWER(TRIM(email)) = 'johannes@thepoetryofpeople.com' LIMIT 1;
  IF aid IS NULL THEN
    INSERT INTO public.agencies (id, name, city, focus, email)
    VALUES (
      'a1000000-0000-4000-8000-000000000099'::uuid,
      'The Poetry of People',
      'Berlin',
      'High-Fashion',
      'Johannes@thepoetryofpeople.com'
    );
    aid := 'a1000000-0000-4000-8000-000000000099'::uuid;
  END IF;
  UPDATE public.models SET agency_id = aid WHERE name = 'AMI S.';
END $$;
