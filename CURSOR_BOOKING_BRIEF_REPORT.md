# CURSOR_BOOKING_BRIEF_REPORT

## 1. Executive Summary

The **Booking Brief** adds five structured production fields (`shoot_details`, `location`, `contact`, `call_time`, `deliverables`) inside existing `calendar_entries.booking_details` as `booking_brief`. Each field has `scope` (`shared` or party-specific) and `text` (max 4000 chars). Persistence uses existing `updateBookingDetails` with optimistic locking. UI is a shared `BookingBriefEditor` on agency, client web, and model calendar booking details when `option_request_id` is present.

## 2. Datenmodell

- **Storage:** `booking_details.booking_brief` (JSONB subtree, no new table or migration).
- **Shape:** `Partial<Record<FieldKey, { scope, text }>>` — see `src/utils/bookingBrief.ts` and `BookingDetails` in `src/services/calendarSupabase.ts`.

## 3. Shared-vs-private-Modell

- **Shared:** `scope === 'shared'` — all parties see the field in the app.
- **Private:** `scope === 'agency' | 'client' | 'model'` — only that party sees the field; others get no row for that key in the filtered view.
- **Technical:** Stored in one JSON blob; **UI** filters via `filterBriefForRole` / editor rules — same trust boundary as existing `*_notes` fields (full JSON if the row is readable).

## 4. Kanonische UI/UX

- **Primary editor:** Existing calendar booking detail modals — `AgencyControllerView`, `ClientWebApp`, `ModelProfileScreen`.
- **Pattern:** Section “Booking brief” with per-field visibility toggles (everyone vs party-only), badges, separate **Save brief** action; shared notes and legacy private notes unchanged below.

## 5. Integration surfaces

- Agency: calendar tab, option-linked row detail.
- Client: `ClientWebApp` calendar overlay.
- Model: `ModelProfileScreen` calendar entry modal.

## 6. Rules decision

- **Updated:** `.cursor/rules/auto-review.mdc` — one additive bullet describing Booking Brief as workflow metadata, not security/chat.
- **Not changed:** `.cursorrules`, `system-invariants.mdc` (beyond auto-review).

## 7. Why visibility model is unchanged

No RLS or policy changes; org-wide calendar access rules are unchanged. Party separation for brief fields mirrors the existing notes pattern (UI + product contract).

## 8. Why Auth/Admin/Login untouched

No edits to `AuthContext`, `App.tsx`, `signIn`, `bootstrapThenLoadProfile`, `loadProfile`, admin RPCs, or `get_my_org_context`.

## 9. Next step

Stabilize brief usage in production (manual verify per `CURSOR_BOOKING_BRIEF_VERIFY.md`). **Kanban** remains a separate product decision; it is not required for the brief. Further polish: optional `booking_events` JSON for the rare “no calendar row” case only if product needs it.
