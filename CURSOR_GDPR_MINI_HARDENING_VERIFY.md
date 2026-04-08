# CURSOR — GDPR Mini Hardening Verify

## Local (2026-04-08)

| Step | Result |
|------|--------|
| `npm run typecheck` | OK |
| `npm run lint` | OK (5 pre-existing warnings, 0 errors) |
| `npm test -- --passWithNoTests --ci` | OK — 71 suites, 754 tests |

## Supabase (live)

| Step | Result |
|------|--------|
| Migration `20260512_gdpr_mini_hardening_cleanup_export_retention.sql` | Applied via Management API — **HTTP 201** |
| Routines `cleanup_conversation_participants`, `get_user_related_tables` | Present (`information_schema.routines`) |
| Edge Function `delete-user` | Deployed (`npx supabase functions deploy … --project-ref ispkfdqzjrfrilosoklu`) |

### Manual re-check SQL

```sql
SELECT routine_name FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN ('cleanup_conversation_participants', 'get_user_related_tables')
ORDER BY 1;
```

### Optional smoke

- Authenticated client: `rpc('get_user_related_tables')` — expect JSON array of table names.
- After a real user delete: logs should not show repeated hard failures from `cleanup_conversation_participants` (occasional log on transient errors is acceptable).

## Edge

After user delete, logs should not show repeated hard failures from `cleanup_conversation_participants` (occasional log on transient errors is acceptable).
