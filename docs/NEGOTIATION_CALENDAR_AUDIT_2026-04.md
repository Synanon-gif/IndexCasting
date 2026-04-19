# Negotiation & Calendar Flow — Static Findings Report (2026-04)

**Audit type:** static code + invariant audit
**Scope:** Option / Casting → Negotiation → Job → Calendar lifecycle, all six canonical perspectives
(Client Owner, Client Employee, Agency Owner, Agency Booker, Model with App-Account, Model without App-Account).
**Companion document:** [`NEGOTIATION_CALENDAR_QA_MATRIX.md`](./NEGOTIATION_CALENDAR_QA_MATRIX.md) — runtime QA test plan.

**Method:** Parallel exploration of services, stores, attention pipeline, calendar projection, agency-only flow,
model-data-safety, and role-specific UI views. Findings are categorized by severity (BLOCKER / RISK / POLISH /
COVERED), each with a `file:line` reference and the impacted invariant from `system-invariants.mdc`.

---

## 1. Executive Summary

| Category | Count | Action |
|---|---|---|
| **BLOCKER** | 0 | — |
| **RISK** | 7 | Should be fixed in a follow-up; none are GA-blocking but each has a concrete failure mode |
| **POLISH** | 6 | Code hygiene, UX drift, deprecated paths |
| **COVERED** | 14 | Explicitly verified — no action |

**Top-line conclusion:** the canonical invariants (axes K, model-account-linked B, trigger-chain F.1, calendar-retry
M, isAgencyOnly propagation O/T, agency-only price-lock R, model-safe-select D) are respected end-to-end. The
remaining risks are isolated edge-cases (system-message audit-trail gap on post-RPC refresh failure, calendar
update missing a `cancelled` filter, one client-side handler that silently ignores a service `false` return,
and a deprecated dead-code path).

---

## 2. BLOCKER

**None.** All canonical invariants verified — see Section 5 (COVERED).

---

## 3. RISK — substantive findings, follow-up recommended

### R1 — `agencyConfirmAvailabilityStore`: missing system-message on post-refresh failure

**File:** [`src/store/optionRequests.ts`](../src/store/optionRequests.ts) lines **828–860**
**Invariant:** S (full DB-refresh after every RPC mutation)

**Finding:** When `agencyAcceptRequest` succeeds (RPC OK) but the subsequent `getOptionRequestById` returns `null`
(network blip, transient RLS issue), the function logs a `console.warn` and returns `true` — but **skips the
`agency_confirmed_availability` system message emission**. This creates an audit-trail gap where the row's
`final_status` flipped to `option_confirmed` server-side, but no system message is rendered in the chat thread.

**Symptoms in production:**
- Thread header attention updates correctly (next refresh)
- Chat history is missing the canonical "Agency confirmed availability" line
- Difficult to triage in support cases (no chat-side audit trail)

**Recommended fix:** Move the `addOptionSystemMessage('agency_confirmed_availability')` call **outside** the
`if (updated)` branch. The message ID and `created_at` come from the system-message RPC response, not from
the `option_requests` row — they are independent. Keep the `console.warn` in the null-fallback for the local
cache update.

```typescript
const result = await agencyAcceptRequest(req.id);
if (result === null) return false;

// System message is independent of cache refresh — always emit.
const inserted = await addOptionSystemMessage(req.id, 'agency_confirmed_availability');
if (inserted) { messagesCache.push({ ... }); }

const updated = await getOptionRequestById(req.id);
if (updated) { Object.assign(req, toLocalRequest(updated)); }
else { console.warn('[agencyConfirmAvailabilityStore] post-refresh failed — local state may be stale', req.id); }

notify();
return true;
```

---

### R2 — `agencyAcceptClientPriceStore`: identical missing-system-message pattern

**File:** [`src/store/optionRequests.ts`](../src/store/optionRequests.ts) lines **866–898**
**Invariant:** S

**Finding:** Same structure as R1 — `agency_accepted_price` system message is only emitted inside
`if (updated)`. On `getOptionRequestById === null`, the price flipped to accepted server-side but the chat
shows no audit line.

**Recommended fix:** Same restructure as R1 (system message before cache refresh).

---

### R3 — `confirmRejectNegotiation` ignores `agencyRejectNegotiationStore` return value

**File:** [`src/web/ClientWebApp.tsx`](../src/web/ClientWebApp.tsx) lines **6109–6118**
**Invariant:** Service-layer Option A contract — frontend handlers must check `.then(ok)`

**Finding:** The agency "Remove request" confirmation handler awaits `agencyRejectNegotiationStore(threadId)`
but **discards the boolean return value**. On RPC failure (e.g. RLS rejection, model-side race), the UI still
calls `setRequests()` + `showNegotiationCalendarHint()` and gives the agency a "success-feel" — even though
the backend rejected the operation.

```typescript
// Current (lines 6113–6116):
void (async () => {
  await agencyRejectNegotiationStore(threadId);   // ← return value ignored
  setRequests(getOptionRequests());
  showNegotiationCalendarHint();
})();
```

The companion handler `confirmRejectCounterOffer` (lines 6086–6102) does this **correctly** —
checks `ok`, shows alert on failure. R3 brings the agency-side handler to parity.

**Recommended fix:**

```typescript
void (async () => {
  const ok = await agencyRejectNegotiationStore(threadId);
  if (!ok) {
    showAppAlert(
      uiCopy.optionNegotiationChat.removeRequestFailedTitle,
      uiCopy.optionNegotiationChat.removeRequestFailedMessage,
    );
    return;
  }
  setRequests(getOptionRequests());
  showNegotiationCalendarHint();
})();
```

(Adds two new `uiCopy` keys.)

---

### R4 — `updateCalendarEntryToJob` updates cancelled rows

**File:** [`src/services/calendarSupabase.ts`](../src/services/calendarSupabase.ts) lines **407–473**
**Invariant:** G (single canonical event per lifecycle), N (writes only on active rows)

**Finding:** The function updates **all** `calendar_entries` matching the `option_request_id`, with no
`status != 'cancelled'` filter. In the rare scenario where an option was rejected (cancelled cal entries
created) and then re-created with the same option_request_id (not currently a product flow, but possible via
admin tooling or future merge logic), this would re-activate cancelled entries to `entry_type='booking'` /
`status='booked'`.

```typescript
// Current select (line 409–412): no status filter
const { data: rows, error: selErr } = await supabase
  .from('calendar_entries')
  .select('id, client_name')
  .eq('option_request_id', optionRequestId);
```

**Recommended fix:** Add `.neq('status', 'cancelled')` to the SELECT and to the UPDATE's `.in('id', ids)`
chain — defense-in-depth filter at both query stages, consistent with `appendSharedBookingNote` /
`updateBookingDetails` which already filter active rows (Invariant N).

---

### R5 — `fetchCalendarEntriesByOptionIds`: no query-level cancelled filter

**File:** [`src/services/calendarSupabase.ts`](../src/services/calendarSupabase.ts) lines **483–497**
**Invariant:** Defense-in-depth (no functional bug today; payload bloat)

**Finding:** Internal helper used by client/agency calendar aggregators. Cancelled rows are filtered later
during projection mapping, but the query returns them — increasing payload and forcing every consumer to
re-filter.

**Recommended fix:** Add `.neq('status', 'cancelled')` at the query level. Reads to the same table elsewhere
(`getCalendarForModel`, `getCalendarRange`) already filter cancelled at query time — bring this helper to
parity.

---

### R6 — `updateModelApproval` is dead code, but dangerous if revived

**File:** [`src/services/optionRequestsSupabase.ts`](../src/services/optionRequestsSupabase.ts) lines **1236–1319**
**Invariant:** F.1 (model rejection trigger chain), Q (DB refresh after RPC)

**Finding:** Workspace-wide grep (`rg "updateModelApproval"`) shows **only the definition itself** — no callers
remain in `src/`. The canonical paths are `modelConfirmOptionRequest` / `modelRejectOptionRequest`, which
correctly avoid setting `final_status` in the UPDATE payload (so trigger `fn_reset_final_status_on_rejection`
can do its work).

`updateModelApproval` writes `model_approval` directly with a `model_approval='pending'` race guard but
**bypasses the canonical reject-system-message emission and the post-RPC `Object.assign(req, …)` cache
refresh** described in Invariant Q. If a future contributor re-introduces it (e.g. for a "quick approve"
shortcut), it will silently deviate from the canonical pattern.

**Recommended fix:** Delete the function entirely (preferred) or annotate it `@deprecated — use
modelConfirmOptionRequest / modelRejectOptionRequest` with a JSDoc warning. Add an ESLint rule banning new
imports if the function is kept.

---

### R7 — Missing E2E coverage for the agency-only lifecycle

**Scope:** Test files under `src/services/__tests__/`, `src/store/__tests__/`
**Invariant:** Test requirement (`agency-only-option-casting.mdc` §14)

**Finding:** Existing tests (`optionRequestsAgencyOnly.test.ts`, `optionRequestsHardening.test.ts`) cover the
RPC contract with mocks but **no end-to-end pass** that exercises:
1. `createAgencyOnlyOptionRequest` (model with account)
2. `fn_ensure_calendar_on_option_confirmed` trigger fires → `calendar_entries` row exists
3. Model approves via `modelConfirmOptionRequest`
4. Agency confirms job via `agencyConfirmJobAgencyOnlyStore`
5. `calendar_entries.status` upgraded to `booked`

The runtime QA matrix in the companion doc (Section 3.1 A-row + 3.4 D4) closes this gap manually.
A real Jest+Supabase-test-client integration suite would prevent regression.

**Recommended fix:** Add `src/integration/__tests__/agencyOnlyLifecycle.it.test.ts` running against a
disposable Supabase test project (or staging branch). Out of scope for this audit — file the ticket.

---

## 4. POLISH — code hygiene, UX drift, deprecation

### P1 — `UnifiedCalendarAgenda.tsx` is dead code

**File:** [`src/components/UnifiedCalendarAgenda.tsx`](../src/components/UnifiedCalendarAgenda.tsx)

The active calendar component is `B2BUnifiedCalendarBody`. `UnifiedCalendarAgenda` has no imports anywhere
in the codebase. **Recommended:** delete the file or add `// @deprecated — use B2BUnifiedCalendarBody`.

### P2 — Model calendar uses a separate layout, not `B2BUnifiedCalendarBody`

**File:** [`src/screens/ModelProfileScreen.tsx`](../src/screens/ModelProfileScreen.tsx) (calendar block ~line 1802+)

The model-side calendar implements its own Month/Week/Day rendering. The canonical attention/next-step logic
is correct (`getCalendarDetailNextStepForModelLocalOption`), but this is a code-duplication risk: future
calendar improvements to `B2BUnifiedCalendarBody` won't propagate to the model view automatically.

**Recommended (mid-term):** migrate the model-side calendar to `B2BUnifiedCalendarBody` with `viewerRole="model"`.
Out of scope for this audit.

### P3 — Hardcoded badge labels in `OrgMessengerInline`

**File:** [`src/components/OrgMessengerInline.tsx`](../src/components/OrgMessengerInline.tsx) lines **906–913**

Terminal-state badges `'Removed'` and `'Declined'` are inline string literals instead of `uiCopy.b2bChat.*` keys.
Violates §4b "all user-visible copy must come from `uiCopy`".

**Recommended fix:** Add `uiCopy.b2bChat.bookingCardRemoved` / `bookingCardDeclined` keys, replace literals.

### P4 — Creation flows lack inflight guards (Doppelklick risk)

**Files:**
- [`src/store/optionRequests.ts`](../src/store/optionRequests.ts) `addOptionRequest` lines **219–531**
- [`src/store/optionRequests.ts`](../src/store/optionRequests.ts) `createAgencyOnlyOptionRequest` lines **1313–1354**

**Invariant:** L (inflight guard for critical option store mutations)

`beginCriticalOptionAction` requires a `threadId`, which doesn't exist before insert. Other mutation paths
(`agencyConfirmAvailabilityStore`, etc.) all have the guard. A rapid double-click on "Send option request"
can produce two `option_requests` rows for the same `(model_id, requested_date)`.

**Recommended fix:** Use a `Set<string>` of pending creation keys (e.g. `${model_id}|${requested_date}|${client_id}`)
guarded by a debounce/lock, released once the insert returns the real ID. Add UI button-disabled state during
the lock.

### P5 — `OPTION_REQUEST_SELECT_MODEL_SAFE` includes `currency`

**File:** [`src/services/optionRequestsSupabase.ts`](../src/services/optionRequestsSupabase.ts) lines **33–35**

`currency` is on the model-safe whitelist per `system-invariants.mdc` Invariant D. This is correct (currency
is metadata, not a price), but the inclusion is implicit. **Recommended:** add a code comment documenting
the deliberate inclusion (so future contributors don't "tighten" by removing it accidentally, breaking
display logic).

### P6 — System-message kind table in Invariant K is incomplete

**File:** `.cursor/rules/system-invariants.mdc` (Invariant K table)

The kind `job_confirmed_by_agency` (emitted by `agencyConfirmJobAgencyOnlyStore` line 1269) is **not listed**
in the K-section system-messages table. The table only shows `job_confirmed_by_client`. This is a docs gap,
not a code bug.

**Recommended fix:** Add `job_confirmed_by_agency` row to the K-section table with text:
"Agency confirmed the job (agency-only flow)."

---

## 5. COVERED — explicitly verified, no action required

| # | Verified | Reference |
|---|---|---|
| C1 | Axis K — Axis 1 (price) and Axis 2 (availability) writes never overlap in store/service | `agencyConfirmAvailabilityStore` only sets `final_status`; `agencyAcceptClientPriceStore` only sets `client_price_status` |
| C2 | `modelRejectOptionRequest` does NOT include `final_status` in UPDATE payload | F.1 — `modelRejectOptionRequest` in `optionRequestsSupabase.ts` |
| C3 | `clientConfirmJobStore` has `isAgencyOnly` guard + 200ms calendar retry | M, R — `optionRequests.ts` lines 1039–1144 |
| C4 | `agencyConfirmJobAgencyOnlyStore` has identical retry pattern | M — `optionRequests.ts` lines 1234–1307 |
| C5 | `attentionSignalsFromOptionRequestLike` sets `isAgencyOnly` at all 11 call sites | T — verified via grep across `src/utils/`, `src/components/`, `src/web/`, `src/views/`, `src/screens/`, tests |
| C6 | `calendarProjectionBadge` + `calendarGridColorForOptionItem` cover `waiting_for_agency_to_finalize_job` | P — `calendarProjectionLabel.ts` |
| C7 | `subscribeToConversation` subscribes to INSERT + UPDATE | Risiko 51 — `messengerSupabase.ts` |
| C8 | `bookingEventsSupabase` filters `cancelled` in all three read functions | Risiko 50 — `getBookingEventsForModel`, `getBookingEventsForOrg`, `getBookingEventsInRange` |
| C9 | `appendSharedBookingNote` / `updateBookingDetails` filter active rows (cancelled excluded) | N — `calendarSupabase.ts` |
| C10 | `OPTION_REQUEST_SELECT_MODEL_SAFE` excludes `proposed_price`, `agency_counter_price`, `client_price_status` | D — `optionRequestsSupabase.ts` |
| C11 | `getOptionMessages` filters `visible_to_model = true` server-side for models | D — `optionRequestsSupabase.ts` line 997–998 |
| C12 | `insert_option_request_system_message` RPC sets `visible_to_model = false` for price kinds | D — Migration `20260815` |
| C13 | Migration `20260815` allows `option_confirmed → option_pending` only when `status → rejected` | F.1 — Trigger validate function |
| C14 | Migration `20260716_agency_create_option_request_definitive.sql` uses `uuid` for `p_agency_id`, INSERT+UPDATE pattern, correct `model_approval` for no-account models | §15.6, §15.7 — `agency-only-option-casting.mdc` |

---

## 6. Live-DB verification — Trigger order on `option_requests`

**Date:** 2026-04-19
**Project:** `ispkfdqzjrfrilosoklu`
**Method:** `information_schema.triggers` query via Supabase Management API

**Result (BEFORE triggers, alphabetical PostgreSQL fire order):**

| # | Trigger Name | Event | Function |
|---|---|---|---|
| 1 | `option_requests_updated_at` | UPDATE | `set_updated_at()` |
| 2 | **`tr_reset_final_status_on_rejection`** | UPDATE | **`fn_reset_final_status_on_rejection()`** |
| 3 | `trg_freeze_option_prices_on_acceptance` | UPDATE | `fn_prevent_option_price_mutation_after_acceptance()` |
| 4 | `trg_option_request_set_model_account_linked` | INSERT | `fn_set_model_account_linked_on_insert()` |
| 5 | `trg_option_requests_mirror_org_names` | INSERT, UPDATE | `fn_option_requests_mirror_org_names()` |
| 6 | **`trg_validate_option_status`** | UPDATE | **`fn_validate_option_status_transition()`** |

**Verification result:** ✅ `tr_reset_final_status_on_rejection` (#2) fires **BEFORE** `trg_validate_option_status` (#6).
Invariant **F.1** (Trigger Chain) is satisfied — model rejection (`status → rejected`) lets the reset trigger
modify `NEW.final_status := 'option_pending'` first, then the validate trigger sees the change and accepts
the transition because of the rejection-exception clause introduced in migration `20260815`.

**Bonus observations:**
- `trg_freeze_option_prices_on_acceptance` (between reset and validate) **does not** interfere — it only
  blocks price mutations after acceptance, not status transitions.
- `trg_option_requests_mirror_org_names` writes denormalized `client_organization_name` /
  `agency_organization_name` columns — used by `updateCalendarEntryToJob` (R4) for canonical title
  resolution. Confirms the title-source priority documented in `calendarSupabase.ts` lines 397–406.

**Anti-regression rule:** Renaming `tr_reset_final_status_on_rejection` to a name alphabetically AFTER
`trg_validate_option_status` would silently invert this order and break model decline. Documented in
`system-invariants.mdc` Invariant **F.1** as a stop-condition.

---

## 7. SECURITY DEFINER function inventory (live-DB sanity check)

All ten key functions verified live (2026-04-19):

| Function | `prosecdef` | `row_security` |
|---|---|---|
| `agency_create_option_request` | ✅ true | ✅ off |
| `agency_confirm_job_agency_only` | ✅ true | ✅ off |
| `client_confirm_option_job` | ✅ true | ✅ off |
| `client_reject_counter_offer` | ✅ true | ✅ off |
| `delete_option_request_full` | ✅ true | ✅ off |
| `insert_option_request_system_message` | ✅ true | ✅ off |
| `fn_reset_final_status_on_rejection` | ✅ true | ✅ off |
| `fn_cancel_calendar_on_option_rejected` | ✅ true | ✅ off |
| `fn_ensure_calendar_on_option_confirmed` | ✅ true | (trigger context) |
| `fn_validate_option_status_transition` | n/a (trigger) | (trigger context) |

**Verification result:** ✅ All SECURITY DEFINER functions used from RLS-protected paths set
`row_security = off` per `system-invariants.mdc` SECURITY DEFINER pattern. Trigger-only functions
(`fn_ensure_calendar_on_option_confirmed`, `fn_validate_option_status_transition`) correctly omit it
because they execute under trigger context, not as PostgREST RPC.

---

## 8. Follow-up — recommended action plan (not part of this audit)

1. **R1 + R2:** restructure system-message emission in `agencyConfirmAvailabilityStore` and
   `agencyAcceptClientPriceStore`. Single PR. ~10 LOC.
2. **R3:** add `uiCopy` keys + boolean check in `confirmRejectNegotiation`. Same PR as R1+R2 if scope allows.
3. **R4 + R5:** add `.neq('status', 'cancelled')` filters to `updateCalendarEntryToJob` and
   `fetchCalendarEntriesByOptionIds`. Single PR. ~5 LOC. Migration not required.
4. **R6:** delete `updateModelApproval` (preferred) or annotate `@deprecated`. Confirm zero callers via grep
   before delete.
5. **R7:** ticket the integration test suite — schedule for next release cycle.
6. **P1–P6:** schedule hygiene PRs; non-blocking.

**Estimated effort R1–R6:** ~1 dev-day including tests.

---

## 9. References

- `system-invariants.mdc` — full invariant catalog (especially K, B, F.1, M, O, P, Q, R, S, T, D)
- `option-requests-chat-hardening.mdc` — Status-Trigger and chat hardening canon
- `agency-only-option-casting.mdc` — agency-only flow invariants
- Companion document: [`NEGOTIATION_CALENDAR_QA_MATRIX.md`](./NEGOTIATION_CALENDAR_QA_MATRIX.md)
