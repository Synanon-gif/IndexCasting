# Regression audit — Option / Casting / Negotiation / Calendar / Roles (2026-04)

This document records the **automated/static** regression pass and **manual QA** obligations. It does not replace staging/production sign-off.

## Scope (per product plan)

- Option request lifecycle, negotiation, delete/reject, calendar (month/week/day), Smart Attention, client/agency/model parity, entry points, guest constraints, booker/employee access, RLS/RPC expectations.

## Static audit — findings

### Verified (no code defect found)

1. **Delete / reject — atomic path**  
   - `delete_option_request_full` (migration `20260546`) cascades messages, calendar rows, booking_events, user_calendar_events, notifications metadata, thread prefs, then `option_requests`. Blocked when `final_status = job_confirmed`.  
   - UI trash delete and agency “remove negotiation” use `deleteOptionRequestFull` / `agencyRejectNegotiationStore` → same RPC + `purgeOptionThreadFromStore`.  
   - `agencyRejectRequest` remains **tests + legacy service only** — not used in product UI.

2. **Client web — calendar refresh after negotiation**  
   - `showNegotiationCalendarHint` calls `onOptionProjectionChanged` → parent wires `loadClientCalendar`.  
   - Explicit delete passes `onOptionRequestDeleted` → `loadClientCalendar`.

3. **Deeplinks**  
   - Client: `navigateToOptionThreadFromCalendar(optionRequestId)` sets `openThreadIdOnMessages` + loads option requests + `setSelectedThreadId`.  
   - Agency: booking rows with UUID `option_request_id` → `setSearchOptionId` + Messages tab.  
   - See [QA_CALENDAR_DEEPLINK_PARITY.md](./QA_CALENDAR_DEEPLINK_PARITY.md).

4. **Smart Attention — single source**  
   - `deriveSmartAttentionState` + `smartAttentionVisibleForRole` in `optionRequestAttention.ts`.  
   - Agency calendar “Action needed” uses `needsAgencyActionForOption` (same derivation for agency visibility). **Exported and covered by unit tests** (`agencyCalendarUnified.attentionParity.test.ts`) to prevent drift.

5. **Dedupe**  
   - Client and agency calendar grids use `dedupeCalendarGridEventsByOptionRequest` (`calendarProjectionLabel.ts`).

6. **Guest / no session**  
   - `addOptionRequest` does not call the backend without `user.id`; package/guest flows that need options require an authenticated session (see QA doc).

### Known limitations (documented, not “fixed” as product change)

1. **`hasConflictWarning` / `conflict_risk`**  
   - No production path sets `hasConflictWarning: true`; schedule conflict is checked at insert time via `check_calendar_conflict`, not persisted as a row flag. Turning this into live Smart Attention would be a **product/schema decision**, not a regression fix.

2. **Peer notification on full delete**  
   - `delete_option_request_full` removes notification rows tied to the `option_request_id`. A **new** “request deleted” notification to the other party is **not** inserted by this RPC; realtime/inbox may update by absence of the thread. Adding a dedicated notify is a product decision.

3. **Model-initiated delete**  
   - RPC allows callers with `option_request_visible_to_me` (includes linked model per DB design). **Primary UI** for delete is client/agency Messages; model flow focuses on approve/reject availability — align any future model “withdraw” UX with product explicitly.

## Automated tests added / touched

- `src/utils/__tests__/agencyCalendarUnified.attentionParity.test.ts` — parity between `needsAgencyActionForOption` and `deriveSmartAttentionState` + agency visibility.  
- `src/utils/agencyCalendarUnified.ts` — export `needsAgencyActionForOption` (documented; same implementation as before).

## Manual QA matrix (required for full sign-off)

Execute on **staging** (or agreed environment) with real accounts:

| ID | Scenario | Roles |
|----|----------|--------|
| P0-1 | Create → negotiate → counter → accept → confirm → job | Client, Agency |
| P0-2 | Delete before `job_confirmed` from Messages; calendar has no ghost; deeplink to old id fails gracefully | Client, Agency |
| P0-3 | Delete blocked after `job_confirmed` (UI + server) | Client, Agency |
| P0-4 | Calendar → thread opens by **option request UUID** only | Client, Agency, Model |
| P0-5 | Same negotiation behaviour from Discover, Project, Package, Messenger | Client |
| P1 | Smart Attention: header vs list vs calendar “Action needed” consistent | Agency |
| P1 | Booker / Employee: can see and act on org-scoped requests | Agency, Client |
| P2 | No duplicate negotiation footer/meta (`suppressDuplicateMeta` / desktop layout) | Agency, Client web |

Cross-check **§2d** in `.cursor/rules/auto-review.mdc` when touching related flows in follow-up work.

## Sign-off statement (template)

> P0 manual checks [ ] completed on [environment] on [date].  
> Remaining risks: [list].  
> Automated: `npm run typecheck`, `npm run lint`, `npm test` — green on [date].

## Files changed (this audit pass)

- `src/utils/agencyCalendarUnified.ts` — export `needsAgencyActionForOption`.  
- `src/utils/__tests__/agencyCalendarUnified.attentionParity.test.ts` — new.  
- `docs/REGRESSION_AUDIT_OPTION_CASTING_CALENDAR_2026-04.md` — this file.
