# Mother Agency — informational free-text fields

> Status: **shipped 2026-12-03** (`supabase/migrations/20261203_mother_agency_fields.sql`).
> Companion rule: [`.cursor/rules/mother-agency.mdc`](../.cursor/rules/mother-agency.mdc).

## What it is

Two free-text columns on `public.models`:

| Column                      | Type | Purpose                                                   |
| --------------------------- | ---- | --------------------------------------------------------- |
| `mother_agency_name`        | text | Display name of the agency that primarily represents this model. |
| `mother_agency_contact`     | text | Booker email / phone / name. Agency-internal in the UI.   |

Both columns are nullable. `NULL` means "this agency is the primary
representation, no mother agency to display."

## What it is NOT

The mother-agency fields are **purely informational**. They:

- Do **not** influence package or API imports (MediaSlide / Netwalk / future).
- Do **not** participate in `importModelAndMerge` matching or merging.
- Do **not** affect ownership, `agency_id`, territories, or claim flow.
- Do **not** change RLS, discovery, search, filtering, or castings/options/bookings.
- Do **not** trigger audits, notifications, webhooks, or outbox rows.

If you find yourself reading `mother_agency_*` to make a decision, you are
holding it wrong — either the rule is wrong, or you are about to ship a bug.
Discuss in product first.

## Edit path

`agency_update_model_full(... p_mother_agency_name, p_mother_agency_contact)`
is the **only** writer.

| Wire value                  | Meaning                              |
| --------------------------- | ------------------------------------ |
| `NULL`                      | No change.                           |
| `''` or whitespace          | Explicit clear (column → `NULL`).    |
| Non-empty string            | Trimmed and persisted.               |

The Add-Model and Edit-Model flows in `AgencyControllerView.tsx` are the only
callers today. Any new caller MUST go through `agencyUpdateModelFullRpc`.

## Visibility

- `mother_agency_name` — visible to anyone who can read the model row
  (Agency, the model, territory-paired clients) per existing models RLS.
  UI label: `Mother Agency: <name>`.
- `mother_agency_contact` — same RLS scope on the column itself, but the UI
  must restrict display to Agency Owners and Bookers. Clients and the model
  themself MUST NOT have a UI surface that renders it.

## Tests guarding these invariants

- `src/services/__tests__/motherAgency.test.ts`:
  - Importer never emits `mother_agency_*`.
  - Hostile provider payloads stripping `mother_agency_*` are no-ops.
  - `buildEditState` initialises empty strings from `null` / missing values.

Removing or weakening these tests is a release blocker.
