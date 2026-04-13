-- C2: Explicit REVOKE/GRANT for agency-only RPCs (parity with client_confirm_option_job).
REVOKE ALL ON FUNCTION public.agency_create_option_request(uuid, text, date, text, text, text, text, text, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agency_create_option_request(uuid, text, date, text, text, text, text, text, uuid, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.agency_confirm_job_agency_only(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agency_confirm_job_agency_only(uuid) TO authenticated;
