# Option / Casting Request Flow — Technical Reference

English-only technical documentation for engineers and product. This describes the **current** architecture as implemented in the IndexCasting codebase, not a redesign.

---

## 1. What is an Option vs a Casting Request?

Both are rows in `public.option_requests`. They share the same lifecycle, threading, calendar hooks, and B2B booking card behavior.

- **Discriminator:** `request_type` is `'option'` or `'casting'`.
- **Semantics:** Casting is the same negotiation pipeline with a different label and client-facing copy; fee negotiation (`proposed_price`, `agency_counter_price`, `client_price_status`) applies in both when used from the client UI.
- **Booking events:** When mirrored into `booking_events`, the event `type` follows `request_type` (casting → `casting`, otherwise option/job rules apply — see service `createBookingEventFromRequest` in `optionRequestsSupabase.ts`).

---

## 2. Start Points

| Context | Where | Notes |
|--------|--------|------|
| Global client discovery | `ClientWebApp` — Discover, detail overlay, option date picker | Uses model summary `countryCode` when present for territory resolution. |
| Shared project mode | Same `handleOptionRequest`; `project_id` from active shared project | `isSharedMode`: curated project models only; option actions remain enabled (not the external read-only share link). |
| Package / guest-link package view | `handleOptionRequest` adds `source: 'package'` and `packageId` when `packageViewState` is set | Propagates into B2B booking card metadata (`bookingChatIntegrationSupabase`). |
| Customer swipe (native) | `CustomerSwipeScreen` → `addOptionRequest` | Same store + Supabase path as web client. |
| **Not allowed** | Read-only external shared selection (`SharedSelectionView`, `?shared=1&…`) | No auth, no org context, no option CTA — by design. |

---

## 3. Communication Model

Three parallel surfaces are intentional:

1. **Option thread** — `option_request_messages` keyed by `option_request_id`. Roles `client` | `agency` in DB; model-facing copy may appear as system/agency messages when relevant.
2. **B2B org chat** — `conversations` with stable `context_id` from org pair (`b2bOrgPairContextId`). A **typed** messenger message with `messageType: 'booking'` and metadata (`model_id`, `country_code`, `date`, optional `option_request_id`, optional `source`/`package_id`) is created when a request is submitted (`createBookingMessageInClientAgencyChat`). This is **not** a duplicate of the option thread; it gives the org-to-org inbox a booking-shaped card and can power a safe `Open related request` jump when `option_request_id` is present.
3. **Calendar + booking_events** — After confirmation paths, `calendar_entries` and `booking_events` link via `option_request_id` / `source_option_request_id` (see migrations and `calendarSupabase` / `optionRequestsSupabase`).

Do not assume a single chat replaces the others without a product decision.

---

## 4. Model Approval Flow

- On insert, `insertOptionRequest` sets `model_account_linked` from `models.user_id`, `model_approval` to `'pending'` if linked, otherwise `'approved'` with `model_approved_at` set (negotiation proceeds client↔agency only).
- **Agency accept** (`agencyAcceptRequest`): If no linked model account, immediate `option_confirmed` path; if linked, awaits model approval before full confirmation (see RPC implementation and comments in `optionRequestsSupabase.ts`).
- Model UI lists requests with priority for `model_approval === 'pending'` (`ModelView` inbox).

---

## 5. From Option to Job

Rough state machine (simplified; DB is source of truth):

- `status`: `'in_negotiation'` | `'confirmed'` | `'rejected'` — negotiation lifecycle.
- `final_status`: `'option_pending'` | `'option_confirmed'` | `'job_confirmed'`.
- `client_price_status`: `'pending'` | `'accepted'` | `'rejected'` — fee branch.

**Price / counter:** Agency counter → client accept/reject (`clientAcceptCounterStore`, `clientRejectCounterStore`). Calendar entry for confirmed option is created by **DB trigger** (`fn_ensure_calendar_on_option_confirmed` — see migration comments referenced from `optionRequests` store), not by a mandatory client-side upsert on that path.

**Job confirm:** `clientConfirmJobStore` calls `clientConfirmJobOnSupabase`, updates local `finalStatus` / `status`, calls `updateCalendarEntryToJob`, notifications to agency org + model user when applicable.

---

## 6. Calendar Representation

- **Entry types** (`calendar_entries.entry_type`): `personal` | `gosee` | `booking` | `option` | `casting` — see `calendarSupabase.ts` types.
- **Colors:** `src/utils/calendarColors.ts` — `CALENDAR_COLORS` + `calendarEntryColor()`. Option-request **message list** pills use a separate map `OPTION_REQUEST_CHAT_STATUS_COLORS` (negotiation vs calendar entry type — different concepts).
- **Merged views:** Client and agency calendar UIs merge manual user events, booking-event-derived entries, and option-linked rows; dedupe logic skips redundant booking rows when a `calendar_entry` already exists for the same `option_request_id` (implemented in `ClientWebApp` and `AgencyControllerView`).

---

## 7. Conflict Behavior

Before `insertOptionRequest`, the client store calls `checkCalendarConflict` (see `optionRequests.ts`). **Intentionally fail-open:** overlapping bookings produce a warning alert only; the user may still submit. Copy lives in `uiCopy.calendarValidation` / dashboard conflict strings.

---

## 8. Search / Deep-Link Behavior (Agency)

- `search_global` RPC (`searchSupabase.ts`) returns org-scoped models, option requests, conversations.
- `GlobalSearchBar` requires `orgId`; option rows open via `onSelectOption(id)`.
- In `AgencyControllerView`, selection sets `searchOptionId`, switches tab to Messages, passes `pendingOptionRequestId` into the messages subtree; an effect sets `selectedThreadId` to open that option thread.

---

## 9. Shared vs Private Notes

- `calendar_entries.booking_details` JSON: `client_notes`, `agency_notes`, `model_notes` (role-private fields) and `shared_notes` (append-only timeline visible to parties). See `calendarSupabase.ts` `BookingDetails` type and model/agency screens that guard edits when `option_request_id` is present.

---

## 10. Security / Org-Scope / Paywall Touchpoints

- **Org-scoped reads/writes:** Option services use `organization_id` / `agency_organization_id` filters where applicable (`getOptionRequests`, `getOptionRequestsForAgency` with org bridge). Client inserts set `organization_id` and (after store hardening) `client_organization_id` and `agency_organization_id` when resolvable.
- **Territory:** Agency for the request is resolved via `resolveAgencyForModelAndCountry` with **ID-based** fallback to `models.agency_id` (documented exception to email matching — see workspace rules).
- **B2B chat:** Pair resolution via SECURITY DEFINER RPCs (`resolve_b2b_org_pair_for_chat`, etc.) — no email-based access in policies for this flow.
- **Paywall:** Not reimplemented here; gated features must continue to rely on backend truth (`can_access_platform` / RLS). This document does not change paywall order or admin bypass rules.

---

## 11. Known Invariants

- Option thread id equals `option_requests.id` (`threadId` in the local store after server reconciliation).
- Admin/auth/login files and `App.tsx` routing are out of scope for routine option-flow edits; do not couple option UX refactors to auth.
- External read-only shared link does not create option requests.
- Calendar conflict check on submit is warning-only.
- DB triggers own calendar creation on option confirmation paths as documented in code comments — avoid duplicate client upserts on those paths.

---

## 12. Known Non-Goals / Intentional Behaviors

- **Dual channels** (option thread + B2B booking card) remain; consolidating them would be a product change.
- **Model inbox display status** uses `toDisplayStatus` + `statusHelpers` colors (Draft/Sent/Confirmed/Rejected), which are **not** identical to option-thread pill colors — different screens, different abstractions.
- **Legacy rows** may have null `agency_organization_id` / `client_organization_id`; agency listing uses OR filter on `agency_id` vs `agency_organization_id` during transition (`getOptionRequestsForAgency`).

---

## Primary Code Map

| Concern | Location |
|--------|-----------|
| Client optimistic + territory + conflict + B2B card | `src/store/optionRequests.ts` |
| Supabase CRUD, uploads, booking events | `src/services/optionRequestsSupabase.ts` |
| Calendar merge / types | `src/services/calendarSupabase.ts` |
| B2B booking card | `src/services/bookingChatIntegrationSupabase.ts` |
| B2B org pair / conversations | `src/services/b2bOrgChatSupabase.ts` |
| Client UI | `src/web/ClientWebApp.tsx` |
| Agency UI / search deep-link | `src/views/AgencyControllerView.tsx` |
| Model inbox | `src/views/ModelView.tsx` |
| Search UI | `src/components/GlobalSearchBar.tsx` |
| Calendar colors | `src/utils/calendarColors.ts` |
| Display status mapping | `src/utils/statusHelpers.ts` |
