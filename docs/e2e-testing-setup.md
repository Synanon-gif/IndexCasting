# E2E testing data environment — setup guide

This describes the **operational** E2E / Playwright data layer added on branch `e2e-test-environment`.  
**No product code, auth, RLS, schema, or migration changes** are part of this setup — only:

- `scripts/e2e/seed-e2e-world.mjs` — seed runner
- `docs/e2e-test-accounts.md` — account matrix
- `.env.e2e.example` — env template
- `package.json` — `npm run seed:e2e`
- `.gitignore` — ignores `.env.e2e` and generated `docs/e2e-seed-manifest.json`

---

## 1. Purpose

Provide **realistic, cross-role** data so Playwright can exercise:

- Login (agency owner, booker, client owner, employee, model, applicant)
- Organizations, paywall trial defaults (via normal org creation triggers)
- **35** roster models + **1** extra unlinked stub (+ territories, agency locations)
- Client **projects** (6 themes) + **12** models on the first project
- **Option** + **casting** requests, negotiation **thread messages**
- **B2B org chat** (`conversations` + `messages`, canonical `b2b:<sorted-org-uuid-pair>` context)
- **Calendar** rows (past + overlapping future)
- **Notifications** (read + unread samples)
- **Guest link** (portfolio package)
- **Recruiting** `model_applications` row
- **Public org profiles** (`organization_profiles`, `is_public: true` — still **fake** content only)

---

## 2. Safety rules

1. **Dedicated database only** — empty Supabase project, local stack, or Supabase **branch**; never run against production with real customers.
2. Set `E2E_ALLOW_SEED_ON_THIS_DATABASE=I_UNDERSTAND` in `.env.e2e`.
3. Script is **additive** (upsert / insert). It does **not** delete or rewrite unrelated rows. Partial failures log warnings.
4. **Email**: Auth users use `email_confirm: true` — **no magic-link inbox** required. Disable or redirect real SMTP in non-prod if your project sends mail.
5. **Service role** is required — treat like a root credential; keep only in CI secrets or local `.env.e2e`.

### 2b. Playwright write gates (harness-only)

Read-only and smoke tests can run against any `E2E_BASE_URL`. **Stateful** tests are latched:

| Gate | Env value | Tests |
|------|-----------|--------|
| Chat writes | `E2E_ALLOW_CHAT_WRITES=I_UNDERSTAND` | B2B roundtrip, Agency↔Model send |
| Option lifecycle | `E2E_ALLOW_OPTION_LIFECYCLE_MUTATIONS=I_UNDERSTAND` | `p0-option-lifecycle-mutations` |
| Hosted / non-local-dev | `E2E_ALLOW_HOSTED_WRITES=I_UNDERSTAND_HOSTED_WRITE_RISK` | **Additional** requirement when base URL is not localhost/loopback or typical LAN (RFC1918); e.g. Vercel, `www.index-casting.com` |

**Never** set hosted-write ack unless every account and row touched is disposable E2E data. Re-seed after option lifecycle mutations. See `docs/e2e-test-matrix.md` (write classification).

---

## 3. Quick start

```bash
cp .env.e2e.example .env.e2e
# Fill EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
# E2E_SEED_USER_PASSWORD (≥16 chars), E2E_ALLOW_SEED_ON_THIS_DATABASE=I_UNDERSTAND

npm run seed:e2e
```

After success, the script writes **`docs/e2e-seed-manifest.json`** (gitignored) with resolved `agency_id`, `organization_id`, and user UUIDs for debugging or future tests.

---

## 4. Image strategy

- **No copyrighted or scraped media.**
- Portfolio / polaroid mirrors use **`https://placehold.co/...`** URLs with **E2E TEST** labels — neutral geometric placeholders, varied aspect ratios.
- Guest / org logos use the same host. No minors, no NSFW, no celebrity likeness.

If you later need **`model_photos` + Storage** parity, run a **separate** follow-up (upload pipeline) — out of scope for this non-invasive seed.

---

## 5. Data relationships (overview)

- **Primary agency** (`e2e-agency-owner`): large roster; booker shares org; links to client via seeded B2B chat + options.
- **Boutique / solo** agencies: smaller slices of the model pool (deterministic modulo rules) for **multi-agency** discovery smoke.
- **Client org** (`e2e-client-owner`): six projects; employee is `e2e-client-team`.
- **Models**: deterministic IDs `aaaaaaaa-0000-4e2e-8000-<12-hex>` for n=1..35; stub 36 for unlinked roster row.
- **Model linked to account**: first model row ↔ `e2e-model-linked`.
- **Territories**: `model_agency_territories` includes at least **DE, FR** (+ home country when different).

---

## 6. Workflow coverage matrix

| Area | Covered by seed |
|------|-----------------|
| Login | All listed accounts share `E2E_SEED_USER_PASSWORD` |
| Agency shell | Owner + booker same org |
| Client shell | Owner + employee |
| Discovery inputs | 35 models, visibility flags varied |
| Projects | 6 client projects, 12 models on project 1 |
| Option / casting | 2 `option_requests` |
| Negotiation chat | `option_request_messages` samples |
| B2B messaging | `conversations` + `messages` |
| Calendar | `calendar_entries` (overlaps) |
| Notifications | 2 rows (read / unread) |
| Packages | `guest_links` portfolio |
| Recruiting | `model_applications` pending |
| Public profiles | `organization_profiles` ×2 |

**Not fully automated in seed (optional next steps):**

- `user_calendar_events` manual blocks for every user
- Rich `option_requests` state machine across all terminal statuses (prefer **scenario-specific** tests)
- Stripe / paywall edge cases
- Storage-mirrored `model_photos` for every model

---

## 7. Reset / re-seed

- **Re-run** `npm run seed:e2e` on the same DB: idempotent user upserts and many upserts reapply. `option_requests` / `messages` may **duplicate** if inserts do not use natural keys — for a pristine DB, **wipe the E2E project** or use a fresh branch.
- Recommended: **throwaway Supabase project** per CI job.

---

## 8. Risks

| Risk | Mitigation |
|------|------------|
| Accidental prod run | Safety env latch + separate Supabase project |
| Schema drift | Script logs non-fatal warnings; fix mapping when columns rename |
| Duplicate option rows on re-run | Use fresh DB or extend script with idempotency keys |
| `listUsers` page cap (1000) | Raise pagination if your test DB shares many unrelated users |

---

## 9. Confirmation statements (this change set)

- **Production logic / auth / RLS / routing / business rules:** **not modified** (only `package.json`, `.gitignore`, `scripts/e2e/`, `docs/`, `.env.e2e.example`).
- **Real user data:** **not read or updated** by this repo change; the **operator** chooses which DB URL to point the script at.
- **Migrations:** **none** added (data-only tooling).

---

## 10. Files touched (deliverable checklist)

| File | Role |
|------|------|
| `scripts/e2e/seed-e2e-world.mjs` | Seed implementation |
| `.env.e2e.example` | Env template |
| `docs/e2e-test-accounts.md` | Accounts (no secrets) |
| `docs/e2e-testing-setup.md` | This guide |
| `package.json` | `seed:e2e`, Playwright `e2e*` scripts |
| `.gitignore` | `.env.e2e`, `docs/e2e-seed-manifest.json`, Playwright outputs (see `.gitignore`) |
| `playwright.config.ts`, `tests/e2e/**`, `docs/e2e-test-matrix.md`, `docs/e2e-known-gaps.md` | Playwright harness (see §11) |

---

## 11. Playwright harness (`tests/e2e`)

- **Config:** root `playwright.config.ts` — loads `.env.e2e` via `dotenv`; **`E2E_BASE_URL`** (preferred) or `PLAYWRIGHT_BASE_URL`; starts `npx expo start --web --port 8081` when the base URL is localhost unless `PLAYWRIGHT_SKIP_WEB_SERVER=1` or `E2E_SKIP_WEB_SERVER=1`.
- **Projects:** `chromium-desktop` (1440×900), `firefox-desktop`, `webkit-desktop`, `mobile-iphone-se`, `mobile-iphone-14`, `tablet-ipad`.
- **Reports:** HTML → `playwright-report/`, JSON → `e2e-artifacts/results.json`, failures → `test-results/` (screenshots, video, trace — gitignored).
- **Diagnostics:** `tests/e2e/helpers/diagnostics.ts` + `fixtures/base.ts` — per-test `diagnostics.json` + `failure-summary.md` on failure (console, page errors, 4xx/5xx + requestfailed, redacted URLs/JWT-like strings).
- **Scripts:** `npm run e2e`, `e2e:headed`, `e2e:debug`, `e2e:report`, `e2e:smoke` (`@smoke`, chromium-desktop), `e2e:p0` (`@p0`, chromium-desktop).
- **Matrix & gaps:** `docs/e2e-test-matrix.md`, `docs/e2e-known-gaps.md`.
- **TypeScript:** `tests/e2e` and `playwright.config.ts` are excluded from `tsc --noEmit` (E2E uses Playwright’s runner); run E2E via `npx playwright test`.
