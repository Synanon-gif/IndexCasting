# Live-DB Verification Snapshot (audit follow-up)

Generated as implementation of the deep-audit verification todos. **Not** a product doc for end users.

## 1. `fn_validate_option_status_transition` vs `modelRejectOptionRequest`

**Method:** Supabase Management API `database/query` — `pg_get_functiondef` + `pg_trigger` on `option_requests`.

**Live definition (abridged):** The function raises when:

- `OLD.final_status = 'option_confirmed' AND NEW.final_status = 'option_pending'`

**Trigger:** `trg_validate_option_status` — `BEFORE UPDATE OF status, final_status` on `public.option_requests`.

**Implication:** [`modelRejectOptionRequest`](src/services/optionRequestsSupabase.ts) performs an `UPDATE` setting `final_status: 'option_pending'` while the row can have `final_status = 'option_confirmed'` (guarded by `.eq('final_status', 'option_confirmed')`). That transition is **explicitly rejected** by the live validator.

**`tr_reset_final_status_on_rejection`:** Runs `BEFORE UPDATE OF status` and only mutates `NEW.final_status` when `NEW.final_status = 'option_confirmed'`. The client path sends `option_pending` already, so this trigger does **not** fire its reset branch before validation — it does not resolve the conflict.

**Conclusion:** Live DB state is **incompatible** with the current TypeScript `modelRejectOptionRequest` update shape for the “agency confirmed availability, model rejects” scenario. **QA / product confirmation required** (this verification does not change code).

---

## 2. Duplicate `calendar_entries` per `option_request_id`

**Query:**

```sql
SELECT option_request_id, COUNT(*) AS n,
  COUNT(*) FILTER (WHERE status IS DISTINCT FROM 'cancelled') AS n_active
FROM calendar_entries
WHERE option_request_id IS NOT NULL
GROUP BY option_request_id
HAVING COUNT(*) > 1
ORDER BY n_active DESC NULLS LAST
LIMIT 25;
```

**Result (production):** **No rows** — no `option_request_id` currently has more than one `calendar_entries` row in the sampled result set.

**Note:** The [`appendSharedBookingNote`](src/services/calendarSupabase.ts) multi-row append behavior remains a **latent** integrity risk if duplicates ever appear.

---

## 3. `clientConfirmJobStore` — notification path vs follow-up read

**Code trace:** [`clientConfirmJobStore`](src/store/optionRequests.ts) calls `getOptionRequestById` twice after a successful `clientConfirmJobOnSupabase` (refresh ~846–848, notifications ~868).

**[`getOptionRequestById`](src/services/optionRequestsSupabase.ts):** On PostgREST `error`, logs `getOptionRequestById error:` and returns `null`. On success with no row, `maybeSingle()` yields `null` **without** a guaranteed console line.

**Notification block:** Runs only when `if (full)` from the second `getOptionRequestById`. If `full` is `null` (RLS empty read, or error logged earlier), **no** `console.error` is emitted inside `clientConfirmJobStore` for the skipped notifications — only the generic error from `getOptionRequestById` when `error` is set.

**Conclusion:** **Silent skip** of org/model notifications is possible when the follow-up select returns `null` without error; operational gap between persisted job confirmation and notification delivery remains **observationally valid** from code inspection.

---

## Commands used (reference)

- Project ref: `ispkfdqzjrfrilosoklu` (from workspace rules).
- Token: `.env.supabase` — do not commit.

---

## 4. Core Product Flows audit — Live-DB: `client_confirm_option_job`, `agency_confirm_job_agency_only`, `insert_option_request_system_message`

**Method:** Supabase Management API `POST .../database/query` with `pg_get_functiondef` substring checks (2026-04-13 run).

**Queries / results:**

| Function | Check | Live result |
|----------|--------|-------------|
| `client_confirm_option_job` | Definition contains `v_req_type IS DISTINCT FROM` (request-type guard) | **true** |
| `client_confirm_option_job` | Definition contains `use_agency_confirm_job_for_agency_only` (agency-only block) | **true** |
| `agency_confirm_job_agency_only` | Definition length / contains `job_confirmed_by_agency` (expected post-`20260709_agency_only_hardening.sql`) | **true** (`sysmsg_has_agency_kind` on combined row) |
| `insert_option_request_system_message` | Definition contains `job_confirmed_by_agency` branch | **true** |

**Conclusion:** Production definitions align with the **20260706** client job guard + **20260709** agency job system-message kind (`job_confirmed_by_agency`). No drift detected versus repo migrations for these three routines in this snapshot.

---

## 5. Core Product Flows audit — Casting → client job finalization (code-path / “E2E” substitute)

**Manual browser E2E:** Not executed in CI; **static verification** below substitutes the optional manual Client-Web run.

**UI:** [`NegotiationThreadFooter.tsx`](src/components/optionNegotiation/NegotiationThreadFooter.tsx) renders the client “Confirm job” button only when `clientMayConfirmJobFromSignals(signals)` **and** `request?.requestType === 'option'` (lines ~596–600). For `requestType === 'casting'`, the button is **not** shown.

**RPC:** Live `client_confirm_option_job` includes a `v_req_type` guard consistent with rejecting non-`option` request types (see §4).

**Conclusion:** A client-driven **casting** thread has **no** primary UI path to trigger job confirmation; the RPC would not promote `request_type = 'casting'` to `job_confirmed` via this function. Matches the audit expectation (dead-end or missing button for casting job finalize on client web).
