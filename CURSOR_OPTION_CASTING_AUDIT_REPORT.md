# CURSOR_OPTION_CASTING_AUDIT_REPORT

## 1. Executive Summary

This pass maps the **Option / Casting request** workflow end-to-end (Supabase tables, client store, B2B chat card, calendar/booking mirrors, agency search deep-link, model inbox). It documents UX and technical findings, applies **small, local hardening** (org-centric columns on insert, centralized option-thread status colors + `uiCopy`, model/search list copy), and adds a technical reference doc plus verification checklist. **No changes** were made to `AuthContext.tsx`, `App.tsx`, admin RPCs, `get_my_org_context`, or paywall core.

**Closure label:** `PARTIAL OPTION CASTING HARDENING APPLIED` — documentation + targeted code; no SQL/RLS wave; full product QA remains manual per verify doc.

---

## 2. Ist-Architecture (Flow)

- **Core row:** `option_requests` with `status`, `final_status`, `client_price_status`, `model_approval`, `request_type`, org columns (`organization_id`, `agency_organization_id`, `client_organization_id`).
- **Thread:** `option_request_messages` per `option_request_id`.
- **Parallel B2B surface:** `createBookingMessageInClientAgencyChat` posts a `booking`-typed message into the client↔agency org pair conversation (metadata: model, country, date, optional package source).
- **Calendar / booking:** `calendar_entries` and `booking_events` linked via `option_request_id` / `source_option_request_id`; confirmation calendar rows are driven by **DB triggers** (see code comments in `optionRequests` store); client job confirm calls `updateCalendarEntryToJob`.
- **Client entry:** `addOptionRequest` in `src/store/optionRequests.ts` (used from `ClientWebApp`, package mode, `CustomerSwipeScreen`).
- **Agency:** `AgencyControllerView` loads agency-scoped requests, merges calendar/booking views with dedupe by `option_request_id`, `GlobalSearchBar` + `pendingOptionRequestId` opens the option thread.
- **Model:** `ModelView` inbox loads `getOptionRequestsForModel`, sorts by approval priority.

---

## 3. Answers to the 10 Core Questions (P1)

1. **Option vs casting:** Same table and pipeline; `request_type` discriminates labeling and booking event type mapping.
2. **Statuses / transitions:** `status` (negotiation), `final_status` (option/job depth), `client_price_status` (fee branch), `model_approval` (linked model). See `optionRequestsSupabase` + store helpers (`agencyAcceptClientPriceStore`, counter/job stores).
3. **Start points:** Discovery, shared project mode, package view, native swipe; **not** read-only `SharedSelectionView`.
4. **Threads / chats / notes / calendar:** Option messages table; B2B messenger booking card; `booking_details` private fields + `shared_notes` on calendar entries; calendar + booking_events.
5. **Client ↔ Agency ↔ Model:** Client initiates; agency negotiates/counters; model approves when `model_account_linked`; notifications and system messages on key transitions.
6. **Parallel / duplicate data:** Option thread vs B2B card vs calendar — intentional; UI dedupes booking list vs calendar when same `option_request_id`.
7. **Fail-open / fail-closed:** Calendar conflict on submit = **warn-only (fail-open)**. Status updates use optimistic concurrency (`fromStatus`) where implemented. Paywall remains fail-closed on backend (unchanged).
8. **Triggers / RPCs / optimistic UI:** DB triggers for calendar on confirm (documented in repo); store optimistic insert/rollback for new requests; `agencyAcceptRequest` uses guarded updates.
9. **Paywall / org / territory:** Org filters in services; territory resolution via `resolveAgencyForModelAndCountry` + `models.agency_id` fallback; B2B uses org-pair RPCs.
10. **UI vs model mismatch:** Model inbox uses `toDisplayStatus` + separate color tokens (`statusHelpers`); Messages tab uses negotiation `status` pills — different abstractions (documented as intentional in `docs/OPTION_CASTING_FLOW.md`).

---

## 4. Confirmed UX Findings

| ID | Finding | Class |
|----|---------|-------|
| UX-1 | Model inbox uses Draft/Sent/Confirmed labels from `statusHelpers`, while Messages uses In negotiation / Confirmed / Rejected for the same underlying rows — users switching roles may see different wording. | CONFIRMED_UX_MEDIUM |
| UX-2 | Three communication surfaces (option thread, B2B booking card, calendar) can feel redundant without in-app explanation. | LOW |
| UX-3 | Global search option rows showed `—` for missing model name; replaced with `uiCopy` string for clarity. | LOW (addressed in P6) |
| UX-4 | Model inbox showed raw `request_type` (`option`/`casting`); now uses same labels as thread context copy. | LOW (addressed in P6) |
| UX-5 | Package-origin is visible in B2B metadata but not always surfaced in option thread UI — intentional unless product asks for explicit badge. | MANUAL_REVIEW_REQUIRED |

---

## 5. Confirmed Technical Findings

| ID | Finding | Class |
|----|---------|-------|
| T-1 | `addOptionRequest` did not pass `client_organization_id` / `agency_organization_id` into `insertOptionRequest` though the API supports them — weakens org-centric consistency for new rows. | CONFIRMED_UX_HIGH (data model) — **fixed in P6** |
| T-2 | Duplicate hex colors for option thread pills in `ClientWebApp` and `AgencyControllerView`. | LOW — **centralized in P6** |
| T-3 | `uploadOptionDocument` logs org context skipped — pre-existing; audit trail gap for uploads. | MANUAL_REVIEW_REQUIRED |
| T-4 | Dedupe logic for booking vs calendar duplicated in ClientWebApp and AgencyControllerView — acceptable drift risk on future edits. | LOW |
| T-5 | `hasNewMessages()` in store returns `requestsCache.length > 0` — coarse “badge” semantics. | MANUAL_REVIEW_REQUIRED |

---

## 6. Safe Improvements Applied (P6)

- `src/store/optionRequests.ts` — Resolve `agency_organization_id` via `organizations.agency_id` before insert; set `client_organization_id` to client org id alongside `organization_id`.
- `src/utils/calendarColors.ts` — `OPTION_REQUEST_CHAT_STATUS_COLORS` + theme import for confirmed/rejected alignment.
- `src/web/ClientWebApp.tsx`, `src/views/AgencyControllerView.tsx` — Use shared colors + `uiCopy` for status labels.
- `src/components/GlobalSearchBar.tsx`, `src/views/ModelView.tsx` — `uiCopy` for unnamed model + request type labels.
- `src/constants/uiCopy.ts` — New dashboard keys.
- `src/utils/__tests__/calendarColors.test.ts` — Regression tests for color helpers.
- `docs/OPTION_CASTING_FLOW.md` — Full technical reference (English).

---

## 7. Areas Deliberately Not Touched

- `AuthContext.tsx`, `App.tsx`, sign-in / profile bootstrap, admin RPCs, `get_my_org_context` structure, paywall enforcement code, guest/invite core navigation, broad SQL/RLS/RPC changes.
- Consolidation of option thread + B2B card + calendar into a single UX surface.
- Rework of `hasNewMessages` or upload audit logging.

---

## 8. Why Admin / Auth / Login Stayed Untouched

All scoped work avoids routing, session bootstrap, and admin detection paths. Option flow changes are limited to the option store, shared UI utilities, agency/client/model views that already consume the store, and documentation. No `profiles` RLS or login query path was modified.

---

## 9. Next Safe Steps (`safe_next`)

- Product copy block in option thread when `package` source exists (if desired).
- Optional shared helper for Client/Agency calendar dedupe snippet to reduce drift.
- Replace coarse `hasNewMessages` with unread-aware logic behind a feature flag (requires spec).
- Pass org context into `uploadOptionDocument` audit via `logAction` when row org ids are known.

---

## 10. Closure

The flow is **better documented**, **slightly more consistent** (org columns on new requests, shared status colors, clearer list copy), and **unchanged** for auth/admin. Intuitive parity across all roles is improved but not complete (see UX-1, UX-5).

---

PARTIAL OPTION CASTING HARDENING APPLIED
