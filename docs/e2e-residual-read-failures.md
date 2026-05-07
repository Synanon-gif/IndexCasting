# E2E residual read failures — resolution log (harness + seed, no product code)

## Session: 2026-05-07 (follow-up after B2B shell / Legal gate harness)

### Clusters addressed

| Cluster | Symptom | Fix type | Change |
|---------|---------|----------|--------|
| Agency option/casting parity | After opening linked thread, second lookup for casting row timed out on `1800` / EUR pattern while UI still showed Model 05 detail | **B) Harness** | `returnToAgencyOptionRequestList` in `tests/e2e/helpers/optionCastingRead.ts`: Back is often RN-web **Pressable** without `role="button"` — use `getByText('Back', { exact: true })`; then always re-focus **Option requests** subtab when visible. |
| Client/agency option lists | Wrong sub-tab (`Agency chats` vs **Option requests**) | **B) Harness** | `openClientOptionRequestsArea` / `openAgencyOptionList` — explicit `getByText('Option requests', { exact: true })` (prior session). |
| Recruiting actions | Strict `role=button` missed controls | **B) Harness** | `recruitingAssertions.ts` + `p0-recruiting.spec.ts` (prior session). |
| Model `?booking=` deeplink | Arbitrary `body.length > 120` | **C) Assertion** | Semantic body markers (prior session). |
| Seed / manifest | Duplicate inserts, stable labels | **A) Seed** | `seed-e2e-world.mjs` idempotent lookup by `job_description` / manifest IDs (prior session). |

### Verification (this session)

| Command | Result |
|---------|--------|
| `PLAYWRIGHT_SKIP_WEB_SERVER=1` targeted: `p0-option-casting`, `p0-recruiting`, `p0-calendar` | **12 passed** |
| `PLAYWRIGHT_SKIP_WEB_SERVER=1 npm run e2e:read` | **38 passed**, 0 failed, 0 skipped (~5.2m) |
| `npm run typecheck` + `lint` + `jest --ci --passWithNoTests` | **green** |

### Full `e2e:p0`

- **`e2e:read`** (= `@p0` minus linked-option / B2B roundtrip / agency-sends patterns) is **green** on hosted run used for this report.
- **`e2e:p0`** still includes **write/stateful** specs filtered out of `e2e:read`; run only with explicit **write gates** and isolated data — not required to be green for “read P0” stabilization.

### Confirmations

- No changes under `src/**` or `supabase/**`.
- Write gates unchanged (off) for these runs.
- No hosted chat sends, option lifecycle mutations, or explicit write harness steps executed in these suites.

### Product bug report

- **None filed** for the agency casting-row failure; classified as **harness navigation** (Back / sub-tab), not app regression.
