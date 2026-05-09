# E2E write-path inventory (harness audit)

**Scope:** `tests/e2e/**/*.spec.ts` + `scripts/e2e/seed-e2e-world.mjs`.  
**Purpose:** Classify every potentially stateful or destructive action for **future** gated validation — **no** gates are enabled by default.

## Gate model (reference)

| Env | Effect |
|-----|--------|
| `E2E_ALLOW_CHAT_WRITES=I_UNDERSTAND` | Allows B2B / Agency↔Model **Send** in `p0-messaging.spec.ts`. |
| `E2E_ALLOW_OPTION_LIFECYCLE_MUTATIONS=I_UNDERSTAND` | Allows negotiation/job mutations in `p0-option-lifecycle-mutations.spec.ts`. |
| `E2E_ALLOW_HOSTED_WRITES=I_UNDERSTAND_HOSTED_WRITE_RISK` | **Additional** ack when `E2E_BASE_URL` is hosted (not localhost / typical LAN). Required **together with** chat or lifecycle gate for remote URLs. |
| `E2E_ALLOW_SEED_ON_THIS_DATABASE=I_UNDERSTAND` | Required to run `npm run seed:e2e` (service-role script — **not** Playwright). |

Implemented in `tests/e2e/helpers/env.ts` (`isWriteTestAllowed`).

## Classification legend

| Class | Meaning |
|-------|---------|
| **safe read** | Navigation/assert only; no intended backend mutation via test actions. |
| **soft write** | Product may persist something (e.g. compliance acceptance); not behind chat/lifecycle gates; usually idempotent per user. |
| **stateful write** | Chat, options, jobs — **must** be gate-gated where implemented. |
| **destructive write** | Delete/remove/reject/recruit accept — **not** automated in P0 read suite; P1 placeholders skipped. |
| **external side effect** | Email, webhooks, Stripe — **out of scope** for these tests. |

---

## Per-spec inventory

### `auth-sanity.spec.ts`

| Test | Action | Target | Hosted-risk | Reversible | Gated | Reseed | Idempotent | Shared UI | Class |
|------|--------|--------|-------------|------------|-------|--------|------------|-----------|-------|
| document has title | `goto` `/` | — | low | n/a | n/a | no | yes | no | safe read |

### `public-pages.spec.ts`

| Test | Action | Target | Class |
|------|--------|--------|-------|
| loads / auth UI | `goto`, body assert | — | safe read |
| `/terms`, `/privacy` | `goto`, status/body | — | safe read |

### `guest-link.spec.ts`

| Test | Action | Target | Class |
|------|--------|--------|-------|
| invalid/nonsense tokens | `goto` `/guest/...`, assert | — | safe read |
| HTTP not 500 | `goto` | — | safe read |
| no secrets in HTML | `content()` assert | — | safe read |

### `p0-landing-seo.spec.ts`

| Test | Action | Class |
|------|--------|-------|
| public profiles, root, robots, sitemap | `goto` / `request`, asserts | safe read |

### `preflight.spec.ts`

| Test | Action | Class |
|------|--------|-------|
| B2B/model probes, legal gate visibility | login-like probes, **read** checkpoints | safe read (may hit login UI; no Send) |

### `p0-auth.spec.ts`

| Test | Action | Target | Class |
|------|--------|--------|-------|
| role logins | `signInAs` → may call `dismissLegalAcceptanceIfPresent` | `legal_acceptances` (product) | **soft write** |
| logout | UI sign-out | session | soft write |
| reload session | reload + shell assert | session | safe read |
| invalid credentials | fill wrong password | — | safe read (failed login) |

**Note:** Legal dismissal is **intentional** for E2E shell readiness; it is **not** behind `E2E_ALLOW_*` chat/lifecycle gates (product compliance flow).

### `p0-agency-shell.spec.ts` / `p0-client-shell.spec.ts` / `p0-model-shell.spec.ts`

| Action | Class |
|--------|-------|
| `signInAs`, tab clicks, visibility | safe read (+ **soft write** if Legal runs) |

### `p0-discovery.spec.ts` / `p0-projects.spec.ts`

| Action | Class |
|--------|-------|
| Discover / My Projects open, interaction smoke | safe read |

### `p0-calendar.spec.ts`

| Action | Target | Class |
|--------|--------|-------|
| Month/Week/Day toggles; optional event tap; Escape | calendar UI | safe read (Escape closes overlay only) |
| duplicate title heuristic | body text | safe read |

### `p0-option-casting.spec.ts`

| Action | Target | Class |
|--------|--------|-------|
| Open threads, body/regex asserts; `returnToAgencyOptionRequestList` | — | safe read |
| model `?booking=` | deep link | safe read |

### `p0-recruiting.spec.ts`

| Action | Class |
|--------|-------|
| List + detail; **assert** accept/reject/chat-like controls **visible**; **no** Accept/Reject click | safe read |

### `p0-messaging.spec.ts`

| Test | Action | Target | Hosted-risk | Gated | Class |
|------|--------|--------|-------------|-------|-------|
| agency/client opens Messages | tab open | — | low | n/a | safe read |
| **B2B full roundtrip** | composer `fill`, Send/Enter, verify text ×2 roles | `messages`, conversations | **high** on hosted | `chat` + hosted | **stateful write** |
| model Messages smoke | tab | — | low | n/a | safe read |
| **agency sends to linked model** | composer `fill`, Send/Enter | model thread | **high** on hosted | `chat` + hosted | **stateful write** |

Skipping uses `test.skip(!isWriteTestAllowed('chat'), chatWriteGateSkipMessage())`.

### `p0-option-lifecycle-mutations.spec.ts`

| Test | Action | Target | Gated | Class |
|------|--------|--------|-------|-------|
| linked option full chain | Confirm availability (agency+model), counter or accept fee, client confirm job, calendar tap | `option_requests`, messages, calendar, notifications | `option_lifecycle` + hosted | **stateful write** (multi-step) |

`beforeEach`: `test.skip(!isWriteTestAllowed('option_lifecycle'), ...)`.

**Harness note:** Row locators still use legacy `PLAYWRIGHT|Horizon` strings; read-only `p0-option-casting` prefers `E2E TEST` chains — align in harness-only follow-up if lifecycle flakes.

### `upload-consent.spec.ts`

| Test | Action | Gated | Class |
|------|--------|-------|-------|
| unauthenticated root | body heuristic | n/a | safe read |
| My Models / Add model modal | open modal, assert checkbox visible; **no** Save/Upload | n/a | safe read |
| booking chat file checkbox | **skip** if no chat; assert only | n/a | safe read |

Uses **manual** `fill`+Login (not always `signInAs`); may still hit Legal → **soft write** if user completes terms.

### `p2-visual.spec.ts`

| Action | Class |
|--------|-------|
| screenshot + attach | safe read |

### `p1-expanded.spec.ts`

| Action | Class |
|--------|-------|
| All describes `test.skip(true, BLOCKER_*)` | **no-op** (placeholders) |

---

## Seed script: `scripts/e2e/seed-e2e-world.mjs`

| Aspect | Detail |
|--------|--------|
| **Safety latch** | Exits unless `E2E_ALLOW_SEED_ON_THIS_DATABASE=I_UNDERSTAND`. |
| **Scope** | `@index-casting.test` users; deterministic model UUIDs; `E2E TEST` / `PLAYWRIGHT` labels. |
| **Idempotency** | `option_requests`: `findOptionRequestIdByJobDescriptions` before insert; thread seed messages only on **new** linked insert; `client_projects` by name lookup; `models` / MAT / `organization_members` upserts. |
| **Risk** | **Calendar stress loop** (`calendar_entries`): **insert** without prior existence check — **re-seed can duplicate** personal/tentative rows for the linked model. |
| **Deletes** | None found in script (comment claims no broad DELETE). |

Class: **stateful write** (script only; not Playwright).

---

## Ungated vs gated summary

| Path | Ungated? | Notes |
|------|----------|-------|
| Chat Send / option lifecycle mutations | **No** | Skipped unless `isWriteTestAllowed`. |
| Legal / Terms via `signInAs` | **Yes** (by design) | Product compliance; not classified as “chat/lifecycle”. |
| `upload-consent` manual login + Legal | **Yes** | Same product behavior; no extra harness gate. |
| `seed:e2e` | **Separate latch** | `E2E_ALLOW_SEED_ON_THIS_DATABASE` only. |

**Finding:** No **chat** or **option lifecycle** test can run without explicit env acks + hosted ack when URL is hosted — **as intended**.

---

## `npm run` suites vs writes

| Script | Writes when gates default OFF |
|--------|-------------------------------|
| `e2e:read` | Excludes lifecycle title grep + B2B roundtrip + agency→model send — **read P0 only**. |
| `e2e:b2b` | Includes `p0-messaging` — **write tests skip** without gates. |
| `e2e:p0` | Runs **all** `@p0` including gated writes — **do not** use for read-only CI unless greps inverted. |
