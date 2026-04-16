# GDPR export, account deletion, calendar interop — QA & retention notes

DSGVO-focused calendar channel summary (Art. 15 / 17 / 32, not legal advice): [GDPR_CALENDAR_COMPLIANCE.md](./GDPR_CALENDAR_COMPLIANCE.md).

## Data retention & deletion (high level)

| Area | Behavior |
|------|----------|
| **`export_user_data` RPC** | Full portable JSON for the subject; `user_calendar_events` uses real columns (`date`, `start_time`, `end_time`, …) and includes org-visible rows via `organization_members`. |
| **`anonymize_user_data` RPC** | Profile PII replaced / nulled, `calendar_feed_token_hash` cleared, `organization_members` rows for the user deleted, recruiting chat messages scrubbed where the user created the thread or is the applicant. Audit row inserted with `source = api`. Callable by self or platform admin / super-admin RPCs. |
| **`delete-user` Edge Function** | Removes auth user (`auth.admin.deleteUser`). Caller must be self or admin (via `get_own_admin_flags`). Run after anonymization when a soft GDPR path is used, or as the terminal hard-delete step per product flow. |
| **Bookings / B2B** | Commercial and booking artifacts may remain anonymized or under separate legal retention; `anonymize_user_data` does not claim to delete all `messages` content — see SQL `COMMENT ON FUNCTION`. |

**Multi-org / owner:** Org deletion and account deletion are separate product paths (`delete_organization_data` vs personal delete). Owners should dissolve or transfer orgs before personal deletion where required; the UI surfaces owner-only errors where applicable.

## Manual QA checklist

Full interop audit, architecture notes, and expanded role checklist: [CALENDAR_INTEROP_AUDIT_REPORT.md](./CALENDAR_INTEROP_AUDIT_REPORT.md).

1. **Export (web)** — Client Web settings: Download my data → JSON downloads; no generic error.
2. **Export (web)** — Agency settings: same.
3. **Export (model)** — Web: download works; native: message directs to web for file download.
4. **Export errors** — Force RPC error (e.g. stale staging): user sees `userFacingExportErrorMessage` (permission / session / schema / generic), not only “could not export”.
5. **Calendar .ics (web)** — Model profile, Agency settings, Client Web settings: Download calendar (.ics) saves file; open in Apple/Google.
6. **Feed token** — Create subscription link → alert shows HTTPS + webcal URLs; paste into calendar “Subscribe by URL”.
7. **Revoke feed** — Disable subscription link → old URL returns empty calendar (no enumeration of other users).
8. **Rotate** — New link invalidates previous plaintext token (hash mismatch).
9. **Anonymize** — Self or admin: RPC succeeds; profile email `anon-{uuid}@deleted.invalid`, feed token null.
10. **Delete user** — Edge: self-delete and admin-delete still work after anonymize guard changes.

## Deploy reminders

- Apply migrations `20260822_gdpr_export_user_data_fix_user_calendar_events.sql` and `20260823_calendar_feed_token_and_anonymize_fix.sql`.
- Deploy Edge Function `calendar-feed` with project secrets (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY` as needed per function code).
