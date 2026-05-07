# E2E / Playwright test accounts (IndexCasting)

**Domain:** `@index-casting.test` — reserved-style addresses; **no real inboxes**. Use only on an **isolated Supabase project** or database branch.

## Security

- **Do not commit** real passwords or `SUPABASE_SERVICE_ROLE_KEY`.
- Copy `.env.e2e.example` → `.env.e2e` locally (gitignored).
- Choose one strong password (≥ 16 chars); set as `E2E_SEED_USER_PASSWORD` for seeding and mirror it in `PLAYWRIGHT_TEST_PASSWORD` if needed.

## Seeded auth users (deterministic emails)

| Account key        | Email                               | Role (signup metadata) | Org / note |
|--------------------|-------------------------------------|-------------------------|------------|
| agencyOwner        | `e2e-agency-owner@index-casting.test` | `agent` | Primary **large** agency org (Northwind) after bootstrap |
| booker             | `e2e-booker@index-casting.test`     | `agent` | **Booker** in primary agency org (no second org) |
| agencyBoutique     | `e2e-agency-boutique@index-casting.test` | `agent` | Boutique agency org (Atelier Volt) |
| agencySolo         | `e2e-agency-solo@index-casting.test` | `agent` | Solo agent org |
| clientOwner        | `e2e-client-owner@index-casting.test` | `client` | Fashion client org (Maison Horizon) |
| clientTeam         | `e2e-client-team@index-casting.test` | `client` | **Employee** in client org |
| modelLinked        | `e2e-model-linked@index-casting.test` | `model` | Linked to roster model #1 (`user_id` set) |
| modelUnlinked      | `e2e-model-unlinked@index-casting.test` | `model` | Auth-only persona (no `models.user_id` link in seed) |
| applicant          | `e2e-applicant@index-casting.test` | `model` | Used for **recruiting** application row |

## Password column (intentionally blank in git)

```
E2E_SEED_USER_PASSWORD = <set locally>
```

## Playwright env mapping

- `PLAYWRIGHT_TEST_EMAIL` — e.g. `e2e-agency-owner@index-casting.test`
- `PLAYWRIGHT_TEST_PASSWORD` — same as local seed password

## Labeling rule

All seeded business names, threads, and notes include **`E2E TEST`**, **`PLAYWRIGHT`**, or **`Synthetic`** markers so they are visually identifiable in UI and exports.
