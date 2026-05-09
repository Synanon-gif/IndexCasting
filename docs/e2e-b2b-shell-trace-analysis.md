# E2E B2B shell / navigation — trace analysis (harness-only diagnosis)

## Context

- **Preflight + auth:** green (agency/client/model login succeeds).
- **Failures:** clustered in specs that assume **`Dashboard`** / tab labels right after `signInAs`.
- **Not** `E2E_AUTH_STUCK_SIGNUP` — credential branch and submit path are OK.

## Inspection method

- Fresh `test-results/**` was not guaranteed in-repo (often gitignored).
- Analysis combined: **failure logs from prior runs** (`toBeVisible` on `Dashboard` after `signInAs`, `click` timeouts on `Discover` / `Messages` / etc.) and **code review** of `tests/e2e/helpers/auth.ts` vs. `p0-agency-shell.spec.ts` / `p0-client-shell.spec.ts`.

## Questions 1–10 (checklist)

| # | Question | Finding |
|---|----------|---------|
| 1 | Logged in? | **Yes** — same session satisfies `e2e:auth` and `assertAuthenticatedShell` exit. |
| 2 | Legal/Terms gate blocking shell? | **Yes (likely)** — preflight notes for B2B included “Legal / Terms gate”. Product shows **`LegalAcceptanceScreen`** with title matching `Terms & Conditions`. |
| 3 | Dashboard present but not visible (scroll)? | **Secondary** — primary issue is **gate on top**; if gate cleared, `Dashboard` is expected in tab strip. |
| 4 | Tabs renamed / bottom nav? | Not required to explain failure once gate is accounted for; labels still match `uiCopy` in happy path. |
| 5 | Default tab ≠ Dashboard? | Possible, but **shell spec** only needs `Dashboard` **visible** in nav, not active route. |
| 6 | Overlay/dialog? | **Legal gate** is the blocking overlay-class UX. |
| 7 | Multiple “Dashboard” matches? | Unlikely root cause vs. gate; `.first()` + visible filter already used in shell assertion path. |
| 8 | Mobile vs desktop layout? | **chromium-desktop** project — bottom tabs vs sidebar may affect **click** targets after gate; first failure was **visibility**, not hit box. |
| 9 | Wait too early (bootstrap)? | **Partial** — `assertAuthenticatedShell` could return when **`Logout`** was visible **while Legal gate was still mounted**, so `signInAs` finished **before** terms were dismissed. |
| 10 | Seed/org wrong though preflight green? | **Unlikely** for **Dashboard** visibility; seed issues fit **option/casting copy** / **projects** later, not first shell line. |

## Root cause (conclusion)

**Harness false-positive “workspace ready” for B2B:**

- `assertAuthenticatedShell` treated **Logout** (and possibly other chrome) as sufficient for B2B while **`LegalAcceptanceGate`** (`Terms & Conditions` title) was still **visible**.
- `signInAs` then returned; specs immediately expected **`Dashboard`** → **timeout**.
- **Not** an auth selector regression; **not** proof of product bug without evidence that Legal cannot be completed (preflight completed B2B probes successfully).

## Resolution type

- **A — Harness-only fix (implemented):**
  - B2B **`shellVisible`**: returns **false** while Legal gate title is visible.
  - **`assertAuthenticatedShell` loop** (B2B): if gate visible, run **`dismissLegalAcceptanceIfPresent`** (agency rights row when needed), then continue polling.
  - **Session-resume** path (no email field): dismiss Legal if visible before `assertAuthenticatedShell`; use **`AUTH_SHELL_MS`** for B2B (non-preflight) so dismiss has wall-clock budget.

## Product bug report

- **`docs/e2e-b2b-shell-product-bug-report.md`** — **not created** for this cluster; evidence points to **harness ordering / Legal overlay**, not stuck loading or nondismissible modal in traces we have.

## Artifacts to capture on next local failure

- `test-results/**/error-context.md`
- `npx playwright show-trace test-results/.../trace.zip`
- Screenshot: verify whether **Terms & Conditions** heading is visible when `Dashboard` expectation fails.

---

## Harness changes applied (this session)

| File | Change |
|------|--------|
| `tests/e2e/helpers/auth.ts` | B2B `shellVisible` returns **false** while Legal gate title visible; main loop **dismisses** Legal for non-model roles with correct agency-rights checkbox; session-resume path dismisses Legal + uses `AUTH_SHELL_MS` for B2B (non-preflight); `b2bRequiresAgencyRightsCheckbox()` helper. |
| `tests/e2e/p0-auth.spec.ts` | **Strict mode:** chained `.or()` locators matched **Logout + Dashboard + tab** simultaneously → `expect().toBeVisible()` threw. Fix: **`.first()`** on the full union (commented) — same workspace semantics, single resolved element. |

## Post-fix verification (hosted)

- `p0-agency-shell` / `p0-client-shell`: **pass**
- `e2e:auth`: **9 passed**
- `e2e:b2b`: **8 passed**, **5 failed**, **4 skipped** (skipped = write-gated)
- `e2e:read`: **31 passed**, **5 failed**, **2 skipped** (~5.8m)

### Residual failure cluster (not shell/login)

| Area | Symptom | Likely class |
|------|---------|--------------|
| Option/casting read workflow | No match for `PLAYWRIGHT…` seeded row copy | **Seed / DB parity** (rows or titles differ from manifest expectation) |
| Model `?booking=` deeplink | `body.length` barely under threshold (109 vs 120) | **Harness threshold / sparse shell** or **invalid id** — inspect trace |
| Recruiting detail | `BLOCKER (selector-gap):` no Accept/Reject/Chat button text | **Harness vs UI copy** (buttons not `role=button` or labels changed) — **not** Legal overlay |

**No separate product bug report** filed for the original shell cluster — evidence supported **harness Legal ordering + Playwright strict union**. Residual tests need seed/trace review, not `src/**` changes from this task.
