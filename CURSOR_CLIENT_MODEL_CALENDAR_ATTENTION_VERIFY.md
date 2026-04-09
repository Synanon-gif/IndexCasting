# CURSOR_CLIENT_MODEL_CALENDAR_ATTENTION_VERIFY

## Automated / CI

```bash
cd /Users/rubenjohanneselge/Desktop/Final_IndexC/IndexCasting
npm run typecheck && npm run lint && npm test -- --passWithNoTests --ci
```

## Live DB (after migration deploy)

Deploy + verify (project uses [`scripts/supabase-push-verify-migration.sh`](scripts/supabase-push-verify-migration.sh)):

```bash
bash scripts/supabase-push-verify-migration.sh \
  "supabase/migrations/20260526_add_model_to_project_remove_connection_gate.sql" \
  "SELECT proname, pronargs FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND proname = 'add_model_to_project'"
```

**Expected:** `pronargs = 4`.

Optional — confirm function body has no `client_agency_connections` reference:

```sql
SELECT pg_get_functiondef(p.oid)
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'add_model_to_project';
```

Optional — policy text on `client_project_models`:

```sql
SELECT policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'client_project_models';
```

## Manual matrix (staging / production smoke)

| # | Case | Expect |
|---|------|--------|
| 1 | Client sees model in Discover | Model visible per existing discovery RPCs |
| 2 | Add to project (no prior connection) | RPC succeeds; row in `client_project_models` |
| 3 | Reload | Hydration shows model count + cover via `fetchHydratedClientProjectsForOrg` |
| 4 | Option request | Same as before — no connection insert policy |
| 5 | Option visible client/agency | `option_request_visible_to_me` |
| 6 | Thread opens | option_request id as thread |
| 7 | Model claim / account | unchanged flows |
| 8 | Calendar after confirm | existing triggers + `calendarSupabase` / booking_events |
| 9 | Option → job/booking | `updateCalendarEntryToJob` etc. |
| 10 | Smart Attention | role filters in `optionRequestAttention` |
| 11–15 | No false connection gates | add-to-project path no longer requires `accepted` connection |
