-- Migration: Revoke anonymous access to get_models_by_location
--
-- Finding H-7 (Security Audit 2026-04): get_models_by_location was granted
-- EXECUTE to the `anon` role, bypassing the has_platform_access() paywall
-- check that is only applied for `authenticated` callers. Anonymous users
-- could retrieve model location data without a subscription.
--
-- Fix: revoke the anon grant. Guest-link model lookups use
-- get_guest_link_models() which is intentionally anon-accessible and has
-- its own rate-limit + scope enforcement.

REVOKE EXECUTE ON FUNCTION public.get_models_by_location FROM anon;

-- Keep the authenticated grant so subscribed clients can still use the RPC.
-- GRANT EXECUTE ON FUNCTION public.get_models_by_location TO authenticated;
-- (already granted; this is a no-op but documents the intended state)
