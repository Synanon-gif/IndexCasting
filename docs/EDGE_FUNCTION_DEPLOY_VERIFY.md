# Edge Function Deploy & Verify

Canonical workflow for deploying Supabase Edge Functions and confirming they
landed correctly. Aligned with `.cursor/rules/supabase-auto-deploy.mdc`
(every Edge Function change must be deployed immediately) and the CI hardening
in `.github/workflows/supabase-edge-functions.yml`.

---

## TL;DR

- **CI (recommended):** push to `main` with changes under `supabase/functions/**`
  → `Supabase Edge Functions` workflow deploys all functions, then
  `verify-edge-functions.sh` confirms each is `ACTIVE`. Either step failing
  fails the workflow loudly.
- **Local:** `bash scripts/deploy-supabase-functions.sh` then
  `bash scripts/verify-edge-functions.sh`.
- **Health gate:** `.github/workflows/health-check.yml` polls
  `get_public_health_summary` every 15min — surfaces "the cron itself stopped
  running" without waiting for the next code change.

---

## 1. Deploy

### CI (canonical)

`.github/workflows/supabase-edge-functions.yml` runs on every push to `main`
that touches `supabase/functions/**` or the deploy script. It uses the repo
secrets `SUPABASE_ACCESS_TOKEN` and `SUPABASE_PROJECT_REF`.

### Local single function

```bash
source .env.supabase && \
SUPABASE_ACCESS_TOKEN=$SUPABASE_ACCESS_TOKEN \
npx supabase functions deploy FUNCTION_NAME \
  --no-verify-jwt --project-ref ispkfdqzjrfrilosoklu
```

### Local all functions

```bash
SUPABASE_ACCESS_TOKEN=... SUPABASE_PROJECT_REF=ispkfdqzjrfrilosoklu \
  bash scripts/deploy-supabase-functions.sh
```

The script iterates `supabase/functions/*/`, skips `_shared` / `_templates`,
and skips dirs without an `index.ts` / `index.js`.

---

## 2. Verify (mandatory after deploy)

`supabase functions deploy` can exit `0` even when a single function failed to
register (transient 5xx from the Functions API, malformed `deno.json`, etc.).
The verify step closes that gap.

### What it checks

`scripts/verify-edge-functions.sh`:

1. Lists every local function dir under `supabase/functions/` with an entrypoint.
2. Calls `GET https://api.supabase.com/v1/projects/<ref>/functions` and parses
   the `slug` + `status` for each deployed function.
3. Asserts every local function exists on live **and** has `status = 'ACTIVE'`.
4. Reports `MISSING` (deployed nowhere) or `Non-active` (e.g. `THROTTLED`,
   `REMOVED`) and exits `1` if anything is wrong.

### Run it

```bash
# Local (uses .env.supabase if present)
bash scripts/verify-edge-functions.sh

# CI (already wired into supabase-edge-functions.yml as a follow-up step)
SUPABASE_ACCESS_TOKEN=... SUPABASE_PROJECT_REF=... \
  bash scripts/verify-edge-functions.sh
```

### Sample output

```
▶ Listing local Edge Functions under supabase/functions/
  Found 15 local function(s): create-checkout-session ... stripe-webhook
▶ Querying live Edge Functions list (Management API)
  ✅ create-checkout-session — ACTIVE
  ✅ send-invite — ACTIVE
  ...
Edge function verify: 15 passed, 0 failed
```

### Manual smoke (per function)

For a deeper check that the function actually responds (auth, env vars
configured, etc.) call the function directly:

```bash
curl -i -X POST \
  "https://ispkfdqzjrfrilosoklu.supabase.co/functions/v1/<FUNCTION_NAME>" \
  -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{}'
```

A `401` from a JWT-protected function is a healthy signal that the function is
running and rejecting the missing/anonymous auth.

---

## 3. Health monitoring (separate concern)

`.github/workflows/health-check.yml` runs every 15 minutes and calls the
public RPC `get_public_health_summary`. It fails when:

- `overall_status = 'outage'`, OR
- `last_updated` is more than 30 minutes old (= `pg_cron` job stopped firing).

`degraded` is logged as a workflow warning but does not fail the job — by
design, so a degraded `zombie_orgs_count` does not nag every 15min.

`workflow_dispatch` with `run_full_verify=true` runs
`scripts/observability-verify.sh` (Management API, requires
`SUPABASE_ACCESS_TOKEN` + `SUPABASE_PROJECT_REF` secrets).

---

## 4. Required GitHub secrets

| Secret | Used by | Notes |
|---|---|---|
| `SUPABASE_ACCESS_TOKEN` | edge-functions deploy/verify, health-check (manual) | Personal access token, project-scoped |
| `SUPABASE_PROJECT_REF` | edge-functions deploy/verify, health-check (manual) | e.g. `ispkfdqzjrfrilosoklu` |
| `SUPABASE_URL` | health-check ping | `https://<ref>.supabase.co` |
| `SUPABASE_ANON_KEY` | health-check ping | anon key (RPC is anon-callable) |

---

## 5. Failure playbook

| Symptom | Likely cause | First action |
|---|---|---|
| `verify-edge-functions.sh` reports `MISSING` for a function that was just deployed | Transient deploy failure (deploy step exited 0 but function didn't register) | Re-run the workflow; check the deploy step logs for any non-fatal error |
| `Non-active on live: <fn> (THROTTLED)` | Function hit cold-start / quota limits | Check Supabase project Functions tab; usually self-recovers |
| `health-check` fails with "have not run in X" | `pg_cron` job stopped or paused | Check `cron.job` table; re-enable / re-schedule per `supabase/migrations/*observability_health_checks_cron*.sql` |
| `health-check` fails with `OUTAGE` | A health check returned `down` status | Inspect `system_health_checks` table for the failing `name`; correlate with `system_events` and `system_invariant_violations` |
| Anything else | Run `bash scripts/observability-verify.sh` for a full snapshot | The 10-step report tells you what is broken at the table/RPC/policy/cron level |
