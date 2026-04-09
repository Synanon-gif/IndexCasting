# CURSOR_CLIENT_MODEL_CALENDAR_ATTENTION_DIFF_SUMMARY

## SQL

- **Added:** [`supabase/migrations/20260526_add_model_to_project_remove_connection_gate.sql`](supabase/migrations/20260526_add_model_to_project_remove_connection_gate.sql)
  - `add_model_to_project`: removes `client_agency_connections` / `accepted` prerequisite; keeps auth, org/project match, territory-aligned agency resolution (`v_effective_agency_id`), insert idempotent.
  - `client_project_models` policy `client_project_models_agency_scoped`: INSERT `WITH CHECK` = org member of project org + `models` row exists (no connection join).

## TypeScript

- [`src/services/projectsSupabase.ts`](src/services/projectsSupabase.ts): docblock + removed error mapping branch for `no active connection`.
- [`src/constants/uiCopy.ts`](src/constants/uiCopy.ts): `projects.addToProjectNoConnection` aligned to generic save message (legacy key retained).

## Not changed

- AuthContext, bootstrapThenLoadProfile, admin routing, paywall, booking_brief model.
- `b2bOrgChatSupabase.ts`, `optionRequestsSupabase` insert path, calendar RLS migrations.

## Tests

- No new test file; existing suite green (`npm test -- --passWithNoTests --ci`).
