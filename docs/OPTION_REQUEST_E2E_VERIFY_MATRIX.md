# Option / casting E2E verification matrix

**Purpose:** Structured manual checklist for staging/production. Rows are **not** “done” until filled with **date**, **tester**, **build ID**, and at least **request UUID** plus core fields (`status`, `final_status`, `client_price_status`, `model_approval`) after the step.

**Prerequisites:** Calendar RPC + option insert RLS stability (e.g. migration `20260534_check_calendar_conflict_enum_and_option_requests_insert_paywall.sql`) so send paths do not return 400/403.

**Implementation notes (code, for testers):**

- **Model inbox “action required”** uses `modelInboxRequiresModelConfirmation()` (agency accepted, `final_status === option_confirmed`, `status === in_negotiation`, linked model, `model_approval === pending`). It is **not** the same as `smartAttentionVisibleForRole(..., 'model')`, which intentionally hides `waiting_for_model` from the model role (that flag is for client/agency).
- **Model fetch path** `getOptionRequestsForModel` uses a reduced select (`OPTION_REQUEST_SELECT_MODEL_SAFE`) — **no** `proposed_price`, `agency_counter_price`, or `client_price_status` in the API response. Verify in the browser network tab that those keys are absent for a model session.

---

## Calendar cross-role (mandatory after state changes)

After **each** relevant transition (client send, agency accept, model confirm, reject, job confirm), verify **all three** parties (Client web, Agency, Model) where applicable:

| Check | Pass criteria |
|-------|----------------|
| Same linkage | Calendar entry (or entries) reference the same `option_request_id` as the row under test. |
| Visibility | Each role sees the entry only when RLS/product rules allow (no cross-org leakage). |
| Color vs status | Badge/color matches `calendarEntryColor` / `calendarColors` semantics for the entry’s `status` and `entry_type` after the transition. |
| Reject / cancel | After reject, entries are removed or show cancelled/disabled state per existing triggers/migrations — no stale “confirmed” tile. |

Record the **entry id** (if exposed in UI or via DB) alongside the option request UUID in your step log.

---

## Core send paths (1–5, 22–25)

| # | Scenario | Expected |
|---|----------|----------|
| 1–5 | Discover / Swipe / Portfolio package / Polaroid package / Project → option or casting | Request visible; no 400/403 on RPC/insert |
| 22–25 | Stability | No 400/403; no empty enum strings; org IDs set; no unintended new connection requirement |

## Model without account

| # | Scenario | Expected |
|---|----------|----------|
| 6 | Option → agency confirms | `confirmed`; booking/calendar as per current product |
| 7–8 | Calendar + attention | Client + agency consistent; no model-side confirmation actions |

## Model with account

| # | Scenario | Expected |
|---|----------|----------|
| 9 | Client sends option | `awaiting_model_confirmation` notification after **agency accept** (not necessarily immediately after client send) |
| 10–11 | Model UI | Request visible; **action badge** when model must confirm (`modelInboxRequiresModelConfirmation` gate) |
| 12–14 | Agency / client | Status updates after model confirm |
| 15 | Calendar | All three parties consistent |

## Casting + job

| # | Scenario | Expected |
|---|----------|----------|
| 16–21 | Same as option with `request_type: casting` | Same state machine; job path via `clientConfirmJobOnSupabase` / `final_status` |

## Negotiation + reject

| # | Scenario | Expected |
|---|----------|----------|
| 26–28 | Agency / model / client reject | Status, attention, calendar consistent |
| 29–30 | Counter / accept | `client_price_status` / RPC paths |
| 31 | Model sees **no** price | **Network inspection**: model session response must not include negotiation price columns (reduced select). |
| 32–34 | Agency load, attention, calendar | As above |

---

## Row log template (copy per row)

```
Matrix #: 
Date: 
Tester: 
Build: 
Request UUID: 
status / final_status / client_price_status / model_approval: 
Calendar entry ids (if known): 
Notes / screenshot ref: 
```
