# E2E — Discovery / Filter / Location coverage audit

Read-only harness only (`tests/e2e/**`, `docs/e2e-*.md`). No product/runtime changes in this iteration.

## Seed / determinism

- Canonical seeded model display names: `E2E TEST — Model NN` (`scripts/e2e/seed-e2e-world.mjs`, 35 models).
- Cities cycled: Berlin, Paris, Milan, Amsterdam, London, Barcelona (plus agency `model_locations` rows).
- **Location coverage in E2E:** smoke-level only — we assert seeded copy and counter presence, optional card drill-in. We do **not** assert geolocation, Near me toggles, or GPS (intentionally skipped to avoid permission prompts and hosted writes).

## What was already covered (before this pass)

| Area | Coverage | Notes |
|------|-----------|--------|
| Discover tab reachable | `p0-client-shell.spec.ts` | Tab walk visits Discover |
| Preflight | `preflight.spec.ts` | Discover tab locator smoke |
| Auth smoke | `p0-auth.spec.ts` | Discover visible after login |
| Discovery deep | `p0-discovery.spec.ts` (legacy) | Loose body-text heuristic, fixed wait, optional card click |

**Weaknesses (legacy):**

- `waitForTimeout(6000)` instead of condition-driven waits.
- Body substring heuristics (`discover` / `filter` / `cm`) — low specificity.
- Card selector `/e2e|playwright|cm/` — depends on visible measurements; fragile if layout changes.
- No filter panel / reset / empty-state coverage.
- No structured diagnostics on failure.

## What was added (this pass)

| Test (all `@p0`, read-only) | Behavior |
|-----------------------------|----------|
| Discover loads seeded grid, filter chrome, and read-only card drill-in | Seeded prefix + `N/M` counter with `M>0`; optional non-destructive card open |
| Discover filter panel opens and closes without Save filters | Open/close; **never** clicks Save filters (Supabase write) |
| Discover Female filter shows banner; Reset clears | Assert `Filtered by:` + `Already seen models hidden`; Reset clears banner |
| Discover impossible height range yields empty read state | Height 250–260 (above seeded range); expect empty or `0/0`; Reset restores |
| Discover city substring filter read smoke | Placeholder city `___e2e_no_match_city___`; expect empty; Reset restores |
| Discover scroll + tab switch keeps shell readable | Wheel + Dashboard ↔ Discover; shell still seeds |
| Discover diagnostics snapshot | Attaches `discovery-snapshot-smoke.json`; validates helper |

## Helpers / diagnostics

- `tests/e2e/helpers/discoveryRead.ts` — navigation, filter toggle, panel open/close, `collectDiscoveryReadSnapshot` (pathname, query string, scrollY, filter label sample, counter, filter banner, empty-state flags, tab labels, body snippet, no secrets).
- `tests/e2e/helpers/diagnostics.ts` — on failure, if test title matches `/discover(y)?/i`, appends **Discovery / filters** JSON block to `failure-summary.md`.

## Explicitly excluded (product gap or policy)

| Item | Reason |
|------|--------|
| URL/query persistence for filters | Client web persists filters via `localStorage` + optional Supabase preset load — not querystring-driven; deep-link filtered Discover URL not a stable product contract in harness. |
| Browser back/forward | SPA tab navigation may not push distinct history entries for each tab; risk of flapping or leaving app. |
| Near me / distance assertions | Toggles geo / RPC paths; permission prompts; not read-only safe in CI without dedicated mocks. |
| Save filters | Writes filter preset to Supabase — **forbidden** in read suite. |
| Search (global model name field) | No dedicated Discover search input; country/city filters only. |
| Load-more / pagination | Not asserted (would need stable “load more” control or network hooks). |

## Flaky selector risks

- `getByText(/^Filter(\s*\(\d+\))?$/ )` — assumes single primary discover filter trigger copy matches `uiCopy.filters`.
- `getByPlaceholder('From')` / `To` — valid while only height row uses those placeholders before other groups (true in current `ModelFiltersPanel`).
- Card drill-in selector (`e2e|playwright|cm`) — layout-dependent.
- `Female` pill — `getByText('Female').first()` assumes filter row precedes conflicting labels (usually true on Discover).

## Hosted / unseeded environments

- Read suite **does not fail** on empty Discover (`0/0`) when the target DB has no E2E seed — seed-dependent tests call `test.skip` with `SKIP_NO_DISCOVERY_SEED`.
- **Shell tests** (filter panel open/close, scroll/tab, diagnostics attachment) still run without seed data.

## Residual gaps (future, still read-only)

- Ranked discovery pagination / “load more” failure copy (`discoveryLoadMoreFailed`).
- `discoverFilterMessages` warning/error banners (requires seeded or forced message state).
- Filter persistence race: Supabase preset load vs. localStorage (document only; optional time-stable test with grep).
- Responsive projects: same tests run under `e2e:read` as **chromium-desktop** only per `package.json`; mobile webDiscover layout not in default read job.

## Product bugs found

- None confirmed from this harness-only change set (no production code executed beyond existing app under test).
