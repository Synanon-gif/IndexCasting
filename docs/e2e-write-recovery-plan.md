# E2E write recovery plan — disposable data only

Use this after **accidental** hosted writes, **stale** seeded option threads, or **failed** lifecycle runs. **Never** run seed against production customer databases.

## Default posture

| Rule | Detail |
|------|--------|
| **Do not** set `E2E_ALLOW_CHAT_WRITES`, `E2E_ALLOW_OPTION_LIFECYCLE_MUTATIONS`, or `E2E_ALLOW_HOSTED_WRITES` unless intentionally mutating disposable E2E data. |
| **Do not** set `E2E_ALLOW_SEED_ON_THIS_DATABASE` unless the Supabase project is an **isolated** staging / branch DB. |
| Keep `docs/e2e-seed-manifest.json` local (gitignored) aligned with the DB you test against. |

## Reseed (canonical reset)

1. Point `.env.e2e` at the **same** `EXPO_PUBLIC_SUPABASE_URL` / keys as the app under test.
2. Set `E2E_ALLOW_SEED_ON_THIS_DATABASE=I_UNDERSTAND` (isolated DB only).
3. Run `npm run seed:e2e`.
4. Refresh `docs/e2e-seed-manifest.json` from script output (if written by seed).
5. Re-run `e2e:preflight` + `e2e:read` before attempting gated writes.

**Idempotency:** Option rows are reused when `job_description` (+ `client_organization_id`) matches; new thread messages insert **only** when a **new** linked option row was inserted. Calendar stress inserts may **accumulate** on repeated seeds — see below.

## Detect “corrupted” or stale E2E state

| Symptom | Likely cause | Action |
|---------|--------------|--------|
| Lifecycle spec: Confirm availability missing | Row already advanced or wrong seed | Reseed or use fresh DB; check `option_requests.final_status` / `model_approval` for seeded linked option ID in manifest. |
| Chat roundtrip: message never appears | RLS, wrong thread, or session | Check `failure-summary.md` network 4xx; confirm `b2b_conversation_id` in manifest. |
| Read tests: option row not found | DB not seeded or manifest stale | Reseed; verify `E2E TEST — …` job_description rows exist. |
| Duplicate calendar “E2E TEST — overlap” rows | Multiple seed runs | Accept for disposable DB, or manually delete rows for linked model (SQL outside this doc) on staging. |

## Rotate E2E accounts

- Prefer **re-run seed** (recreates known emails `@index-casting.test` with same passwords if script defines them).
- If passwords leaked: change `E2E_SEED_USER_PASSWORD` + `PLAYWRIGHT_TEST_PASSWORD`, re-seed, update CI secrets.

## Invalidate stale option threads (conceptual)

- **Harness-only:** Point tests at manifest `option_requests.option_id` / labels in env — no product change.
- **Data:** Re-seed or manually reset the row in **staging** only (SQL / admin tooling — not part of this repo’s allowed edit scope for this workstream).

## Clean duplicate rows safely

- **Seed:** Avoid re-running `seed:e2e` dozens of times against the same DB if `calendar_entries` stress inserts matter; use a fresh DB or periodic wipe of **E2E-only** models’ personal rows.
- **Never** broad-delete without scoping to `E2E TEST`/`@index-casting.test`/manifest UUIDs.

## Hosted writes ran by mistake

1. **Stop** CI / local runs; **unset** all `E2E_ALLOW_*` write gates in `.env.e2e`.
2. Identify affected **organization / option / message** IDs from traces (no secrets in artifacts).
3. On **staging only:** reseed isolated DB or restore from snapshot if available.
4. Document incident; rotate passwords if any credential was exposed in logs (artifacts should redact JWTs — verify `failure-summary.md`).

## Disposable data (assumption)

- All `@index-casting.test` users and orgs created by `seed-e2e-world.mjs`.
- Option rows with `job_description` matching `E2E TEST — …` or legacy `PLAYWRIGHT — …` copies tied to seeded client org.
- Chat messages inserted by **tests** when gates were on (timestamp stamps `E2E-B2B-*`, `E2E-AG-MODEL-*`).

## Non-disposable (never target with E2E mutations)

- Production orgs, real customer emails, Stripe-linked billing identities.

## Diagnostics on failure

- See `tests/e2e/helpers/diagnostics.ts`: `failure-summary.md` + `diagnostics.json` include **roleKey**, **writeKind**, **writeGate**, **baseUrl class**, **route (pathname)**, headings, buttons, links, checkpoints, redacted URLs, console/network summaries — **no** passwords, tokens, service role, or JWT payloads in intended attachments.

## References

- `docs/e2e-write-path-inventory.md` — full mutation inventory.
- `docs/e2e-known-gaps.md` — write gate ladder.
- `.env.e2e.example` — env contract.
