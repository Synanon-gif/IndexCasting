# Model save, location, and completeness — canonical notes

## Agency profile save RPC

- **`agency_update_model_full`** is the SECURITY DEFINER path for agency-side writes to `models` (revoked direct column updates for authenticated).
- **Membership guard (20260429):** Authorization is checked against **`models.agency_id`** using the same pattern as **`save_model_territories`**: `organization_members` + `organizations.type = 'agency'` + `bookers` fallback. Admins bypass via **`is_current_user_admin()`**.
- **Do not** resolve the caller agency with `LIMIT 1` on memberships and compare to `models.agency_id` — that diverges from territory RPCs and breaks when the active workspace agency is not the oldest membership row.

## Current location (agency)

| Path | What it writes |
|------|----------------|
| **Single save** (Agency My Models — one model, Save settings) | `models.current_location` + `models.city` / `country_code` via **`agency_update_model_full`**; then **`upsert_model_location`** with `source = 'agency'` (geocode when city present). |
| **Agency roster bulk selection** | **Territories of representation only** (`bulkAddTerritoriesForModels` / territory modal). **No** bulk current location in the app — product rule avoids bulk vs single semantic drift. |

**DB note:** `public.bulk_upsert_model_locations` may still exist from migrations for historical compatibility; the **client no longer calls** it. Do not reintroduce agency bulk UI for current location without an explicit product + security review.

**Canonical spatial truth** for Near Me is **`model_locations`** (`lat_approx` / `lng_approx`, priority: live > current > agency). The `models.current_location` field is legacy/display-oriented; keep single-save behaviour documented here until a deliberate migration merges semantics.

## Completeness / visibility

- **UI:** `checkModelCompleteness` in `src/utils/modelCompleteness.ts` — critical: name, visible portfolio photo, territory (via context flags from `model_agency_territories` / UI).
- **Client discovery** uses backend filters + RLS; the banner is an agency-side hint, not the security layer.
- Incomplete profiles may still save; territory save and model RPC are separate steps in the single-editor flow (territories first, then `agency_update_model_full`).

## Observability

- On RPC failure, log PostgREST fields (`message`, `code`, `details`, `hint`) in development consoles — avoid exposing raw internals to end users in banners.
