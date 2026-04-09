# Add-to-Project P0 — Verify Notes (2026-04-09)

## Root cause (Live)

- **`public.add_model_to_project`** on Live still had to be aligned with product: migration **`20260526_add_model_to_project_remove_connection_gate.sql`** was **deployed via Management API** (HTTP **201**), then verified.
- Live verify (post-deploy): `pronargs = 4`, function body **does not** contain `client_agency_connections` or `no active connection` (`no_connection_gate` / `no_connection_exception` both **true**).
- **RLS** `client_project_models_agency_scoped` (**INSERT**): `with_check` **does not** reference `client_agency_connections` (`insert_policy_no_connection` **true**).

## Code changes (repo)

- **[`src/services/projectsSupabase.ts`](src/services/projectsSupabase.ts):** `addModelToProject` logs `message`, `code`, `details`, `hint`, `serialized` (JSON), and safe `rpcArgs` flags (`has_p_organization_id`, `has_p_country_iso`).
- **[`src/utils/mapAddModelToProjectErrorMessage.ts`](src/utils/mapAddModelToProjectErrorMessage.ts):** Maps using **combined** `message` + `details` + `hint`; adds `not_authenticated` → sign-in copy; legacy connection errors stay **generic** (no “connect first” copy).
- **Tests:** [`src/services/__tests__/mapAddModelToProjectErrorMessage.test.ts`](src/services/__tests__/mapAddModelToProjectErrorMessage.test.ts).

## Not changed

- Auth, Admin, Paywall, Calendar — per scope.

## Frontend bundle / Copy

- [`src/constants/uiCopy.ts`](src/constants/uiCopy.ts) — `projects.addToProject*` strings are **neutral**; legacy key `addToProjectNoConnection` is a generic save message. After **merge to `main`**, Vercel deploy picks up logging + mapper. If users still see old wording, hard-refresh or wait for deployment.

## Manual verify matrix (post-deploy)

| Step | Expected |
|------|----------|
| Client → Discover → **Add to project** | Success feedback; model listed in project |
| **Reload** | Model still in project |
| **My Projects** | Count &gt; 0 for that project |
| On RPC error | **No** “accepted connection / territory connection required” — neutral or specific org/model copy per mapper |
| Brave console on failure | Full `addModelToProject RPC error` object with `serialized` / `details` |

## Quality gates

Run: `npm run typecheck && npm run lint && npm test -- --passWithNoTests --ci`
