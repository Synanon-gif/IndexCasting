-- Optional: documents that this table is the single source for "connection requests"
-- (both directions). No separate `connection_requests` table.
-- Safe to run anytime; does not change RLS or data.
--
-- If an external tool strictly requires the relation name `connection_requests`,
-- you can add later (separate change):
--   CREATE VIEW public.connection_requests AS SELECT * FROM public.client_agency_connections;
-- and verify RLS/PostgREST behavior for your Postgres version before relying on it.

COMMENT ON TABLE public.client_agency_connections IS
  'Unified connection requests (client→agency and agency→client). There is no separate connection_requests table unless you add an optional VIEW for tooling.';
