# E2E known gaps — IndexCasting

This document records **testability limits** without changing product code. When the app misbehaves, prefer a **failing test** + diagnostics (`diagnostics.json`, `failure-summary.md`, trace/video) over silent skips.

---

## 1. Environment & data

| Gap | Impact | Mitigation |
|-----|--------|------------|
| Playwright browsers not installed | Every test fails at launch (`Executable doesn't exist`) | Run `npx playwright install` (or `npx playwright install chromium`) once per machine/CI image |
| No `.env.e2e` or missing password | All role-based tests **skip** with `credentialGapMessage()` | Copy `.env.e2e.example`, set `PLAYWRIGHT_TEST_PASSWORD` or `E2E_SEED_USER_PASSWORD` |
| Seed not run | Discovery/projects may be empty; public slugs 404 | Run `npm run seed:e2e` on isolated DB; align slugs with `E2E_PUBLIC_*` |
| `docs/e2e-seed-manifest.json` gitignored | Option deeplink, `unlinked_option_id`, stable IDs need local seed output | CI can attach the same JSON as a secret file; do not commit |
| Remote `E2E_BASE_URL` | No local Expo autostart | Set `PLAYWRIGHT_SKIP_WEB_SERVER=1` when using hosted URL |
| **Write gates** | **Stateful** tests skip unless explicitly latched | See §1b |
| **`.local` / mDNS hostnames** | Classified as **hosted** (not loopback/LAN IP) | Use `localhost` / LAN IP for gate-free local dev, or set `E2E_ALLOW_HOSTED_WRITES` |

### 1b. Write gate ladder (harness)

| Gate | Env | What it enables |
|------|-----|----------------|
| Chat writes | `E2E_ALLOW_CHAT_WRITES=I_UNDERSTAND` | B2B message roundtrip; Agency↔Model **Send** |
| Option lifecycle | `E2E_ALLOW_OPTION_LIFECYCLE_MUTATIONS=I_UNDERSTAND` | Full option lifecycle mutations (`p0-option-lifecycle-mutations.spec.ts`) |
| Hosted / non-local-dev | `E2E_ALLOW_HOSTED_WRITES=I_UNDERSTAND_HOSTED_WRITE_RISK` | **Additional** ack when `E2E_BASE_URL` is **not** localhost/loopback or RFC1918 LAN — e.g. `www.index-casting.com`, Vercel |

**Read-only and smoke** tests do **not** require these. Failing to set gates produces a **clear BLOCKER** skip reason, not a false pass.

**Never** enable hosted-write ack unless all touched accounts and rows are disposable E2E data. Re-seed after option lifecycle mutations.

---

## 2. Selectors & UX stability

| Gap | Where | Risk |
|-----|-------|------|
| Tab labels assumed exact (`Dashboard`, `My Models`, …) | Shell tests | Breaks if copy changes |
| Calendar **Month / Week / Day** toggles | `p0-calendar` | Uses a11y names; brittle vs. `data-testid` |
| Option row / thread **regex** (PLAYWRIGHT copy, Horizon, …) | `p0-option-casting`, mutations | Tied to seed strings; fragile if seed copy changes |
| **Negotiation thread Back** | `p0-option-casting` (agency) | Often **not** `role="button"` on RN-web — harness uses `getByText('Back')` and re-selects **Option requests** (`returnToAgencyOptionRequestList`) |
| Chat **composer** | `helpers/chatComposer.ts` | Fallback: last `textbox`/`textarea`; RN-web roles may drift |
| **Agency↔model thread row** | `p0-messaging` | Regex on model/org names; if no row matches → `test.skip` with BLOCKER |
| **Bottom tab visibility** in chat workspace | P0.5/P0.6 | Not asserted (product layout); gap documented |

**Future (product approval only):** add `data-testid` for critical thread rows, composers, and negotiation primary buttons — **no** product changes in this harness workstream.

---

## 3. Flows intentionally shallow, skipped, or gated

| Flow | Reason |
|------|--------|
| Full **option → job** (automated) | **Gated** `E2E_ALLOW_OPTION_LIFECYCLE_MUTATIONS` (+ `E2E_ALLOW_HOSTED_WRITES` on hosted); **re-seed** after |
| **B2B / Agency↔Model chat sends** | **Gated** `E2E_ALLOW_CHAT_WRITES` (+ hosted latch) |
| **Read-only** option/casting/unlinked | `p0-option-casting.spec.ts` |
| **Agency-only** job finalization | P1 skip in `p1-expanded.spec.ts` |
| **Model decline / agency remove** | Destructive; P1 |
| **Counter-offer reject** | P1 |
| **Unread badges / notifications** | Flaky without controlled seed |
| **Stripe / paywall** | Out of scope |
| **Destructive recruiting accept** | Avoid; recruiting asserts action buttons, optional chat open **without Send** |

---

## 4. Why full P0 is not 100%

- Many rows are **read/smoke** or **best-effort** skips (manifest, selector-gap), not deep asserts on every edge.
- **Paywall/Stripe**, **multi-browser**, **notification** timing, **agency-only** job path, and **destructive-negative** flows are **not** automated.
- **Write** paths are **opt-in** by design so production-like URLs cannot accidentally mutate data.
- **Weak selectors** (see §2) limit confidence without future `data-testid` work in product code.

---

## 5. Diagnostics limits

| Item | Note |
|------|------|
| Response bodies | Not logged (PII); status + URL (redacted query keys) |
| Auth headers | Not attached; JWT-like / `access_token` / `service_role` scrubbed in console text |
| `failure-summary.md` | On failure: **roleKey**, **emailDomainHint** (domain only), **writeKind**, **baseUrl class** (`local` / `lan-dev` / `hosted`), **writeGate** (`allowed` / `blocked` / `not applicable`), **Route (pathname)** from `page.url()`, Last URL (redacted query keys), checkpoints, storage **key** names only, sample headings/buttons/links, network grouped by status + sample lines, console grouped by type + last lines, typical artifact filenames under outputDir |
| Secret redaction | `eyJ…` JWT-shaped strings, cookies, authorization lines, sensitive URL params — do not rely on redaction for intentional secret logging |

---

## 6. Write-path preparation (harness audit)

| Resource | Purpose |
|----------|---------|
| [`docs/e2e-write-path-inventory.md`](./e2e-write-path-inventory.md) | Per-spec mutation inventory: class (safe read / soft write / stateful / destructive), gates, reseed, idempotence |
| [`docs/e2e-write-recovery-plan.md`](./e2e-write-recovery-plan.md) | Reseed, rotate accounts, stale threads, duplicate rows, accidental hosted writes — **no** automatic gate enablement |

**Intentional gap:** `signInAs` / Legal dismissal produces a **soft write** (`legal_acceptances`) and is **not** behind `E2E_ALLOW_CHAT_WRITES` or `E2E_ALLOW_OPTION_LIFECYCLE_MUTATIONS`. Stateful chat and option lifecycle specs **are** behind those gates + hosted latch.

---

## 7. Multi-browser / viewport

| Gap | Note |
|-----|------|
| `e2e:smoke` / `e2e:p0` | **chromium-desktop** only in default scripts |
| Device names | Tied to Playwright `devices` map |

---

## 8. Failure classification (for reporters)

1. **App bug** — assertion fails with clear user-visible break.
2. **Test / selector** — element not found; fix test or document gap in skip message.
3. **Seed data** — manifest missing `unlinked_option_id`, empty discover; re-seed or env.
4. **Environment** — 5xx on base URL, TLS, wrong `E2E_BASE_URL`.
5. **Write gate** — expected skip when latches not set; not a product regression.

---

## 9. Next recommended tests (priority)

1. Guest link **positive** path with `E2E_GUEST_LINK_TOKEN`.
2. Gated **agency-only** job row (isolated seed + same host/write latches).
3. Align public slugs with deployed staging via `E2E_PUBLIC_*`.
