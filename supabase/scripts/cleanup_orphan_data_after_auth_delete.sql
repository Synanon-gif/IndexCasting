-- =============================================================================
-- Cleanup leftover PUBLIC data after Auth users were removed (Dashboard).
-- CASCADE usually removes profiles; agencies + invitations often remain (email-based).
--
-- Run in Supabase SQL Editor in ONE session (or keep the IN (...) list identical).
-- 1) Run PREVIEW only and check rows.
-- 2) Run DELETE block.
-- =============================================================================

-- --- PREVIEW ---------------------------------------------------------------
SELECT 'agencies' AS tbl, id, name, email
FROM public.agencies
WHERE lower(trim(COALESCE(email, ''))) IN (
  'ruben.elge@student.uibk.ac.at',
  'johannes@thepoetryofpeople.com',
  'arelge@t-online.de'
);

SELECT 'invitations' AS tbl, id, email, organization_id
FROM public.invitations
WHERE lower(trim(COALESCE(email, ''))) IN (
  'ruben.elge@student.uibk.ac.at',
  'johannes@thepoetryofpeople.com',
  'arelge@t-online.de'
);

SELECT 'profiles' AS tbl, id, email, role
FROM public.profiles
WHERE lower(trim(COALESCE(email, ''))) IN (
  'ruben.elge@student.uibk.ac.at',
  'johannes@thepoetryofpeople.com',
  'arelge@t-online.de'
);

-- --- DELETE (after preview) -----------------------------------------------
DELETE FROM public.invitations
WHERE lower(trim(COALESCE(email, ''))) IN (
  'ruben.elge@student.uibk.ac.at',
  'johannes@thepoetryofpeople.com',
  'arelge@t-online.de'
);

DELETE FROM public.agencies
WHERE lower(trim(COALESCE(email, ''))) IN (
  'ruben.elge@student.uibk.ac.at',
  'johannes@thepoetryofpeople.com',
  'arelge@t-online.de'
);

DELETE FROM public.profiles
WHERE lower(trim(COALESCE(email, ''))) IN (
  'ruben.elge@student.uibk.ac.at',
  'johannes@thepoetryofpeople.com',
  'arelge@t-online.de'
);

-- Optional: connection rows whose auth user row is already gone
-- DELETE FROM public.client_agency_connections c
-- WHERE c.client_id IS NOT NULL
--   AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = c.client_id);
