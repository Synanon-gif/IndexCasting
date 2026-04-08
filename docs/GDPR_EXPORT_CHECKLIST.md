# GDPR export checklist (developer / PR)

When adding a **new database table** or **material personal-data store**, work through this before merging.

## Questions

1. **Does the table store personal data** (names, emails, messages, device tokens, IP addresses, etc.)?
2. **Is it user-related** (tied to `auth.users` / `profiles` / org membership / model user link)?
3. **Should it appear in `export_user_data`** (Art. 15 / 20 portability and access copy)?

If **yes** to (1) and (2), default assumption is **yes** to (3) unless legal/product explicitly excludes it.

## PR review steps

- [ ] If export is required: extend [`export_user_data`](../supabase/migrations/20260511_gdpr_export_user_data_phase2.sql) (new migration only; do not edit RLS in the same change unless reviewed).
- [ ] Update [`get_user_related_tables()`](../supabase/migrations/20260512_gdpr_mini_hardening_cleanup_export_retention.sql) so the informational list stays in sync.
- [ ] Update `COMMENT ON FUNCTION export_user_data` in a new migration if the scope description changes.
- [ ] Add or adjust **tests** under `src/services/` if client mapping changes ([`dataExportService.ts`](../src/services/dataExportService.ts) / [`gdprComplianceSupabase.ts`](../src/services/gdprComplianceSupabase.ts)).

## Out of scope for this checklist

- Org-only or agency-owned assets **explicitly** excluded from user export by product/legal (document in PR).
- Tables with **no PII** (reference data only) — document why export is N/A.
