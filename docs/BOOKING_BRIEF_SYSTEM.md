# Booking Brief System

English technical reference. Structured production information for option-linked calendar rows — **not** a chat, **not** an access-control layer.

## Canonical storage

- **Table:** `public.calendar_entries`
- **Column:** `booking_details` (JSONB)
- **Key:** `booking_brief` (optional object)

Lifecycle anchor: rows with `option_request_id` set (option / job / casting on the model calendar). The same path is used after job confirmation; `updateCalendarEntryToJob` does not strip `booking_details`.

**Not stored on `booking_events` in v1:** Synthetic calendar rows from `booking_events` (`bookingEventToCalendarEntry`) have `booking_details: null`. When a real `calendar_entries` row exists for the same `option_request_id`, the brief remains on that row. If a booking existed only as a `booking_event` without a calendar row, the brief would not appear (documented edge case; no migration in v1).

## Data model

Defined in TypeScript: `BookingDetails.booking_brief` in `src/services/calendarSupabase.ts`, shape helpers in `src/utils/bookingBrief.ts`.

Five optional fields (each at most one entry):

| Field key        | Purpose (product)   |
|-----------------|---------------------|
| `shoot_details` | What / how the shoot runs |
| `location`    | Where |
| `contact`     | Who to reach |
| `call_time`   | When to be on set |
| `deliverables`| What must be delivered |

Each set field is:

```json
{
  "scope": "shared" | "agency" | "client" | "model",
  "text": "string (max 4000 chars, trimmed)"
}
```

- **`shared`:** All parties (agency, client org, model) **see the text in the app UI** when they open the same booking calendar detail.
- **`agency` | `client` | `model`:** Only that party sees the field in the UI; others do not see that field’s content (field is omitted from their editor/read view).

**Single source of truth per field:** one object per key — no duplicate “shared copy” and “private copy” of the same meaning.

## Trust model (important)

Visibility is **enforced in the client UI** by `filterBriefForRole` / editor rules, **not** by separate JSONB column RLS. Anyone who can `SELECT` the `calendar_entries` row receives the full `booking_details` payload, same as for `agency_notes` / `client_notes` / `model_notes`. The Booking Brief does **not** change org-wide RLS or introduce a new security boundary.

## Writes

- Service: `updateBookingDetails(optionRequestId, { booking_brief: … }, role)` in `src/services/calendarSupabase.ts` (optimistic lock on `updated_at`, same as other `booking_details` patches).
- Merge: `mergeBookingBriefFromEditor` preserves fields editable by other parties but not shown to the current editor (e.g. agency’s private field while client saves).

### Backend permission parity (RLS)

- `public.calendar_entries` UPDATE is allowed for: agency members (model’s agency), linked model (`model_self`), and **client parties** on rows with `option_request_id` set, via policy `calendar_entries_update_client_scoped` (canonical migration `supabase/migrations/20260502_calendar_entries_rls_canonical_client_update.sql`).
- Scope: same option row the app addresses (`option_request_id` + `model_id` match `option_requests`, `status <> rejected`, caller is legacy `client_id` or member of the option’s client org).
- This does **not** change the trust model: there is still **no** server-side stripping of per-field scopes inside JSONB; anyone who may `SELECT` the row still receives full `booking_details` from the API.

## UI

- Component: `src/components/BookingBriefEditor.tsx`
- Surfaces: calendar booking detail overlays with `option_request_id` — `AgencyControllerView`, `ClientWebApp`, `ModelProfileScreen`
- Copy: `uiCopy.bookingBrief` and extended `uiCopy.calendar` strings (English only)

## Non-goals

- Not a third chat surface (use option thread, B2B org chat, and `shared_notes` for conversation).
- No Kanban, no large calendar refactor, no auth/admin/paywall changes in this feature.
