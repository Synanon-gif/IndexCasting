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
