# Model save incident — report

## 1. Executive summary

Agency users could see **HTTP 400** on **`agency_update_model_full`** after a **successful territory save** on the same model. The RPC previously derived “the caller’s agency” with **`ORDER BY organization_members.created_at ASC LIMIT 1`** and required **`models.agency_id = that id`**. Territory RPCs (**`save_model_territories`**) instead check membership for the **explicit agency** tied to the operation (`p_agency_id`). Any mismatch (e.g. multi-org ordering vs. active workspace) produced **`model_not_in_agency`** while the UI still showed territories as saved.

**Fix:** Redeployed **`agency_update_model_full`** with a **model-scoped** guard: same **`EXISTS`** pattern as territory saves (`org_members` + `type = 'agency'` + `bookers`), **`is_current_user_admin()`** bypass, unowned-model branch unchanged in intent. Live DB verified (`v_model_agency_id` present in `pg_get_functiondef`).

## 2. Root cause(s)

| ID | Classification | Description |
|----|----------------|-------------|
| RC1 | **CONFIRMED_RPC_MEMBERSHIP_MISMATCH** | Implicit “caller agency” via `LIMIT 1` vs. explicit `p_agency_id` semantics in `save_model_territories`. |

Secondary (not primary for this incident but hardened):

| ID | Classification | Description |
|----|----------------|-------------|
| RC2 | **CONFIRMED_UI_ERROR_HANDLING_GAP** | Generic “Save failed” banner without structured logging of PostgREST `message` / `code` / `details`. Addressed via `console.error` object (no user-facing leak). |
| RC3 | **RISK sex CHECK** | Invalid `sex` values could violate `CHECK (sex IN ('male','female'))`. Frontend now sends only `male` / `female` / `null` (null = no RPC change via `COALESCE`). |

## 3. Single vs bulk location

- **Single save:** RPC updates `models.*` including `current_location`; then **`upsertModelLocation`** with `source = 'agency'` when `country_code` is set (with geocode when city present).
- **Bulk:** **`bulk_upsert_model_locations`** only — **`model_locations`** agency row; does not update **`models.current_location`**.

Canonical Near Me truth remains **`model_locations`**. Details: [docs/MODEL_SAVE_LOCATION_CONSISTENCY.md](docs/MODEL_SAVE_LOCATION_CONSISTENCY.md).

## 4. Visibility / completeness

Unchanged architecture: **`checkModelCompleteness`** + context flags (territory, visible photo). Banners can still show while save succeeds — that is expected when portfolio is missing; not the same class as RPC 400.

## 5. What was fixed

- Migration **`20260429_agency_update_model_full_model_scoped_guard.sql`** (applied live, HTTP 201).
- **`AgencyControllerView`:** RPC error logging; **`sex`** sanitization; save strings from **`uiCopy.modelRoster`**.
- Docs + Cursor rules alignment (see plan JSON).

## 6. Rules decision

Guardrails added/updated in **`system-invariants.mdc`**, **`auto-review.mdc`**, **`.cursorrules`** — membership parity for **`agency_update_model_full`** with territory RPCs; document **`MODEL_SAVE_LOCATION_CONSISTENCY.md`**.

## 7. Auth / admin / login untouched

No changes to **`AuthContext`**, **`App.tsx`**, **`signIn`**, **`bootstrapThenLoadProfile`**, **`loadProfile`**, **`get_my_org_context`**, or admin UUID/email RPC definitions.

## 8. Flows that should work after fix

- Agency single model save (My Models) after territory save.
- Import/merge, Mediaslide/Netwalk sync, photo sync — all call **`agency_update_model_full`**; same guard applies.
- Admin: **`is_current_user_admin()`** bypass inside RPC (same class as **`save_model_territories`**).

## 9. Next steps

- Optional product pass: align **bulk** location with **`models.current_location`** or formally deprecate that column for display-only.
- Multi-org agency **UI** switch remains a separate roadmap item; DB no longer relies on “oldest membership” for this RPC’s authorization.

---

**MODEL SAVE INCIDENT FIXED**

After this release, a short regression pass on My Models + one Mediaslide sync is enough before a wider audit; no mandatory “big audit” solely because of this fix.
