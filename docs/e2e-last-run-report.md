# E2E last run report — B2B shell + read P0 stabilization

## Session: 2026-05-07 (hosted, write gates off)

### Write gates (presence only in `.env.e2e`)

| Variable | Key present in file |
|----------|---------------------|
| `E2E_ALLOW_CHAT_WRITES` | **no** |
| `E2E_ALLOW_OPTION_LIFECYCLE_MUTATIONS` | **no** |
| `E2E_ALLOW_HOSTED_WRITES` | **no** |

### Root cause — B2B shell cluster (earlier in session)

1. **`assertAuthenticatedShell` false-positive:** B2B workspace was treated as ready when **`Logout`** was visible while **`Terms & Conditions`** (LegalAcceptance) still covered the shell — `signInAs` returned; specs then timed out on **`Dashboard`**.
2. **`p0-auth` Playwright strict mode:** `expect(dashboard.or(logout).or(tab))` matched **multiple** visible nodes → **strict mode violation** once Legal was dismissed and full nav rendered.

**Harness:** `tests/e2e/helpers/auth.ts`, `tests/e2e/p0-auth.spec.ts` — **no** product changes.

### Root cause — agency option/casting row (residual)

- Thread **Back** in RN-web is often a **`generic` Pressable**, not `role="button"`. Tests fell through to clicking **Messages** without returning to the **Option requests** list → `find OptionRowOrThrow` searched the wrong surface (still inside linked thread, €2500 visible, no casting €1800).

**Harness:** `returnToAgencyOptionRequestList` in `tests/e2e/helpers/optionCastingRead.ts` + use from `p0-option-casting.spec.ts`.

### Results (latest verification)

| Command | Passed | Failed | Skipped | Wall time (approx) |
|---------|--------|--------|---------|-------------------|
| `npm run typecheck` + `lint` + `jest --ci --passWithNoTests` | ✓ | 0 | — | ~20s |
| Targeted Playwright: `p0-option-casting` + `p0-recruiting` + `p0-calendar` | 12 | 0 | 0 | ~3.2m |
| `PLAYWRIGHT_SKIP_WEB_SERVER=1 npm run e2e:read` | **38** | **0** | **0** | **~5.2m** |

**Full `e2e:p0`:** **not** run in this pass. `e2e:read` excludes write/stateful greps; full P0 still needs explicit write gates + isolation for those specs.

### Documentation

- `docs/e2e-b2b-shell-trace-analysis.md` — shell / Legal checklist.
- `docs/e2e-residual-read-failures.md` — residual clusters, fix types, latest `e2e:read` result.
- `docs/e2e-preflight-report.md` — from `e2e:preflight` (separate).
- `docs/e2e-write-path-inventory.md` — per-spec write/mutation inventory + gate matrix (prep only).
- `docs/e2e-write-recovery-plan.md` — reseed / recovery if stateful tests run by mistake (prep only).

### Write-path preparation (same session, no new Playwright run)

- **Gates:** still **off** in `.env.e2e` (no chat / option-lifecycle / hosted-write latches).
- **Scope:** documentation + failure-summary **pathname** + explicit artifact filename hints in `tests/e2e/helpers/diagnostics.ts` only.
- **`e2e:p0` / hosted mutations:** **not** executed in this sub-pass.

### Confirmations

| # | Statement |
|---|-----------|
| 1 | No product code changed |
| 2 | No `src/**` touched |
| 3 | No `supabase/**` touched |
| 4 | Write gates not enabled in `.env.e2e` |
| 5 | No hosted writes / chat roundtrip / lifecycle mutations in read-only suites |
| 6 | Write-gate prep docs only — gates remain default-off; no `e2e:p0` in prep sub-pass |

### Next (optional)

- Re-run `e2e:b2b` if desired for parity metrics (not required for `e2e:read` green).
- Full `e2e:p0` only with write latches and disposable data.

### Branch final audit (2026-05-07)

- Gesammelter Nachweis für Review/Commit: **`docs/e2e-branch-final-audit.md`** (Git-Scope, Secrets, Seed-Safety, Write-Gates, `typecheck`/`lint`/Jest + `e2e:preflight` + `e2e:read`).
- **`e2e:p0`** in diesem Audit-Lauf weiterhin **nicht** ausgeführt; Write-Gates weiterhin standardmäßig **aus**.
