# CURSOR — GDPR Hardening Phase 2 Verify

## Local / CI

```bash
cd /path/to/IndexCasting && npm run typecheck && npm run lint && npm test -- --passWithNoTests --ci
```

Expected: typecheck and lint exit 0; all Jest suites pass.

## Supabase (after deploy)

1. Apply migration `20260511_gdpr_export_user_data_phase2.sql` via Management API or CLI (see workspace `supabase-auto-deploy` rule).
2. Verify function exists:

```sql
SELECT routine_name FROM information_schema.routines
WHERE routine_schema = 'public' AND routine_name = 'export_user_data';
```

3. Smoke test (authenticated user, own `p_user_id`): call `export_user_data` and confirm JSON includes `export_version`, `activity_logs`, `legal_acceptances`, `domains` in client output (via `formatExportPayload`).

## UI

- **Agency settings**: Download still works (web download / native message).
- **Client Web**: Privacy section unchanged behavior.
- **Model profile**: New button triggers web download or native success copy per `uiCopy.privacyData`.
