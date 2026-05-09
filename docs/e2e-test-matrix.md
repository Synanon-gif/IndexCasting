# E2E test matrix — IndexCasting (Playwright)

**Scope:** Tests live under `tests/e2e/`. **No product logic** is modified for E2E; weak selectors and missing seeds are tracked in `docs/e2e-known-gaps.md`.

---

## Write safety classification (all specs)

Legend: **read** = no intentional business write; **smoke** = shallow navigation; **write:chat** = sends B2B or agency↔model messages; **write:option_lifecycle** = confirms, counter, confirm job, etc.; **destructive** = remove/delete/reject paths (none implemented in P0); **external** = email/payment (out of scope).

| File | Classification | Clicks / risk | Gates |
|------|----------------|---------------|--------|
| `auth-sanity.spec.ts` | smoke-only | load | — |
| `public-pages.spec.ts` | read / smoke | legal routes | — |
| `guest-link.spec.ts` | read / smoke | guest URL | — |
| `p0-landing-seo.spec.ts` | read / smoke | public slugs, robots, sitemap | — |
| `p0-auth.spec.ts` | smoke + session | Login, Logout, reload — **session only**, not org data writes | — |
| `p0-agency-shell.spec.ts` | read / smoke | tabs | — |
| `p0-client-shell.spec.ts` | read / smoke | tabs | — |
| `p0-model-shell.spec.ts` | read / smoke | tabs | — |
| `p0-discovery.spec.ts` | read | Discover, card tap | — |
| `p0-projects.spec.ts` | read | project list, row | — |
| `p0-option-casting.spec.ts` | read | Messages rows, thread open, back, Calendar | — |
| `p0-calendar.spec.ts` | read | M/W/D, optional event, Back/Escape | — |
| `p0-recruiting.spec.ts` | read (+ optional nav) | applicant row; optional **Chat** open — **no Send**, no accept/reject | — |
| `p0-messaging.spec.ts` | **write:chat** (2 tests) | **Send**, Enter — real messages | `E2E_ALLOW_CHAT_WRITES` + `E2E_ALLOW_HOSTED_WRITES` if hosted |
| `p0-messaging.spec.ts` | read (3 tests) | Messages tab open only | — |
| `p0-option-lifecycle-mutations.spec.ts` | **write:option_lifecycle** (destructive to seed state) | Confirm availability, model confirm, Accept fee / counter, Confirm job | `E2E_ALLOW_OPTION_LIFECYCLE_MUTATIONS` + `E2E_ALLOW_HOSTED_WRITES` if hosted |
| `upload-consent.spec.ts` | read / UI smoke | Add model modal, checkbox visible — **no** upload/submit | — |
| `p1-expanded.spec.ts` | skip placeholders | — | future writes must use same gate pattern |
| `p2-visual.spec.ts` | smoke | screenshots | — |

**Local vs hosted (harness):** `localhost` / `127.0.0.1` / `::1` and **RFC1918 LAN** (e.g. `192.168.x.x`) = **local-dev class** for gate purposes — only the **kind** gate (chat / option_lifecycle). Any **public DNS** host (Vercel, `index-casting.com`, …) = **hosted** — needs **`E2E_ALLOW_HOSTED_WRITES=I_UNDERSTAND_HOSTED_WRITE_RISK`** in addition.

---

## Env (see `.env.e2e.example`)

| Variable | Purpose |
|----------|---------|
| `E2E_BASE_URL` | App under test |
| `PLAYWRIGHT_TEST_PASSWORD` or `E2E_SEED_USER_PASSWORD` | Login for seeded accounts |
| `E2E_ALLOW_CHAT_WRITES` | Must be `I_UNDERSTAND` for **chat send** tests |
| `E2E_ALLOW_OPTION_LIFECYCLE_MUTATIONS` | Must be `I_UNDERSTAND` for **option lifecycle** mutations |
| `E2E_ALLOW_HOSTED_WRITES` | Must be `I_UNDERSTAND_HOSTED_WRITE_RISK` for **any** of the above when base URL is **hosted** (non-local-dev) |
| `E2E_PUBLIC_AGENCY_SLUG` / `E2E_PUBLIC_CLIENT_SLUG` | Public profile paths (defaults in example) |
| `E2E_GUEST_LINK_TOKEN` | Guest package token (P1) |
| Seed-only | `EXPO_PUBLIC_SUPABASE_*`, `SUPABASE_SERVICE_ROLE_KEY`, `E2E_ALLOW_SEED_ON_THIS_DATABASE` |

**Tag filter scripts:**

- `npm run e2e:smoke` — `--grep @smoke`, project `chromium-desktop`
- `npm run e2e:p0` — `--grep @p0`, project `chromium-desktop`

**Last run (maintainer — re-run after changes):**

- `npm run typecheck` / `npm run lint` / `npm test -- --ci --passWithNoTests` — run after harness edits.
- Safe hosted: `PLAYWRIGHT_SKIP_WEB_SERVER=1 E2E_BASE_URL=https://www.index-casting.com npm run e2e:smoke` / `e2e:p0` — **without** write gates: chat + lifecycle specs **skip** with explicit BLOCKER.
- Ohne Browser-Binary: `npx playwright install chromium`.

---

## Status legend

| Status | Meaning |
|--------|---------|
| **implemented** | Test runs; may **skip** if env credentials, manifest, or **write gate** missing |
| **skip blocker** | `test.skip(true, 'BLOCKER: …')` — precise reason |
| **gated** | Skips unless env latch(es) for **chat**, **option lifecycle**, and **hosted** when applicable |
| **partial** | Read-only / heuristic; not full product lifecycle |
| **informational** | Assertions tolerate 404 (e.g. robots on SPA host) |

---

## P0 — Critical

| ID | Area | Role | Test(s) / file | Tag(s) | Depth | Stateful write? | Gates / notes |
|----|------|------|----------------|--------|-------|-----------------|---------------|
| P0.1 | Auth | Multi | `p0-auth.spec.ts` | `@p0` | smoke | session only | — |
| P0.2 | Agency shell | Agency | `p0-agency-shell.spec.ts` | `@p0` | smoke | no | — |
| P0.3 | Client shell | Client | `p0-client-shell.spec.ts` | `@p0` | smoke | no | — |
| P0.4 | Model shell | Model | `p0-model-shell.spec.ts` | `@p0` | smoke | no | — |
| P0.5a | B2B messaging open | Agency / Client | `p0-messaging.spec.ts` | `@p0` | smoke | no | — |
| P0.5b | B2B messaging roundtrip | Agency + Client | `p0-messaging.spec.ts` | `@p0` | **write:chat** | **yes** | `E2E_ALLOW_CHAT_WRITES` + hosted latch if applicable |
| P0.6a | Agency ↔ Model smoke | Model | `p0-messaging.spec.ts` | `@p0` | read | no | — |
| P0.6b | Agency ↔ Model send | Agency + Model | `p0-messaging.spec.ts` | `@p0` | **write:chat** | **yes** | same + selector-gap skip possible |
| P0.7 | Discovery | Client | `p0-discovery.spec.ts` | `@p0` | read | no | — |
| P0.8 | Projects | Client | `p0-projects.spec.ts` | `@p0` | read | no | — |
| P0.9 | Option (linked) read | Client + Agency | `p0-option-casting.spec.ts` | `@p0` | read | no | — |
| P0.9c | Option lifecycle mutations | Multi | `p0-option-lifecycle-mutations.spec.ts` | `@p0` | **full lifecycle** | **yes (seed)** | option + hosted latches; **re-seed** |
| P0.10 | Option (no model app) | Client + Agency | `p0-option-casting.spec.ts` | `@p0` | read | no | manifest |
| P0.11 | Casting | Client + Agency | `p0-option-casting.spec.ts` | `@p0` | read | no | — |
| P0.12 | Calendar | Agency + Client + Model | `p0-calendar.spec.ts` | `@p0` | read + detail | no | — |
| P0.13 | Recruiting | Agency | `p0-recruiting.spec.ts` | `@p0` | read | optional chat nav only | no Send |
| P0.14 | Public profiles | anon | `p0-landing-seo.spec.ts` | `@p0` | smoke | no | — |
| P0.15 | Landing / SEO | anon | `p0-landing-seo.spec.ts` | `@smoke` `@p0` | smoke | no | — |
| — | Model booking deeplink | Model | `p0-option-casting.spec.ts` | `@p0` | read | no | manifest |
| — | Public / guest / upload | — | `guest-link`, `upload-consent`, … | mixed | see classification table | | |

---

## P1 — Extended

| Area | File | Status |
|------|------|--------|
| My Models, territories, guest token, negotiation edges | `p1-expanded.spec.ts` | **skip** — BLOCKER references future **write gates** |

---

## P2 — Visual / responsive

| Area | File | Status |
|------|------|--------|
| Screenshots | `p2-visual.spec.ts` | needs creds where applicable |

---

## Coverage estimate (conservative — no false confidence)

These are **automated checklist** bands, not “% of all user journeys” and not security proof.

| Tier | Approx. | Meaning |
|------|---------|--------|
| **No credentials** | **~20–30%** | Public/smoke-only rows; most role-specific P0 **skipped** |
| **Creds + seed; write gates OFF** | **~35–50%** | Read/smoke P0 including shells, discover, option **read** paths, calendar read; **chat roundtrip + lifecycle** **skipped** |
| **Creds + seed + all required write gates** | **~50–60%** | Adds gated **chat** + **option lifecycle** where selectors and seed state match — still **no** paywall/Stripe, notifications, agency-only job path, multi-browser parity, or full destructive-negative suite |

**Not claimed:** full product coverage, RLS proof, or “production-safe” testing without disposable data.

---

## Covered files (test code only)

- `playwright.config.ts`
- `tests/e2e/**/*.ts` (helpers, `global-setup.ts`)
- `scripts/e2e/**`, `docs/e2e-*.md`, `.env.e2e.example`

Product areas **exercised** (when tests run): auth, dashboards, discover/projects/calendar/messages, negotiation read paths, **gated** negotiation/chat writes, public routes, diagnostics (`failure-summary.md` includes `roleKey`, `writeKind`, `baseUrl class`, `writeGate`).
