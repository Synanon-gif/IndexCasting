# Calendar closure — staging QA matrix

This checklist supports the **Final Calendar Reality QA** after the calendar hardening pass (projection badges, negotiation refresh hooks, month-grid dedupe, unit tests). **Execute on staging (or production smoke) with real accounts** — it cannot be signed off from code review alone.

**Baseline hardening commit (reference):** `8c691a6` — `fix(calendar): projection labels, refresh on negotiation, grid dedupe`

## Product decision (open)

| Topic | Question | Default until decided |
|-------|----------|------------------------|
| Rejected option rows | Should `option_requests.status === 'rejected'` **disappear** from Client/Agency upcoming calendar lists, or remain visible with a **Rejected** badge? | Current UI: they can remain visible (future-dated) with badge — see Client `sorted` filter (date only). |

---

## Matrix (1–11)

Mark each **Pass / Fail / N/A** with initials and date.

### 1. Discover → Option → Calendar

- [ ] Event appears for client and agency with correct date
- [ ] Badge matches negotiation state (`uiCopy.calendar.projectionBadge`)
- [ ] Agency and client see consistent schedule truth (same option row / RLS)

### 2. Project → Option → Calendar

- [ ] Same as (1) when option originates from a project context

### 3. Package → Option → Calendar

- [ ] Same as (1) when option originates from guest/package flow

### 4. Counter offer / negotiation

- [ ] After price/counter/accept/reject paths, calendar refreshes without full page reload (`onOptionProjectionChanged` → `loadClientCalendar` / `loadAgencyCalendar`)
- [ ] Badge updates match thread state
- [ ] No permanent stale row after refresh completes (brief async lag acceptable)

### 5. Client delete before job

- [ ] Option removed or cancelled; calendar row gone after delete + refresh
- [ ] No orphan duplicate on same day (`optionRequestId` dedupe)

### 6. Agency reject/delete before job

- [ ] Same cleanup as (5) for agency-initiated reject/delete

### 7. Option → Job conversion

- [ ] No double tile for same logical booking (`calendar_entries` + `booking_events` dedupe by `option_request_id`)
- [ ] Final badge reflects job vs option (`getCalendarProjectionBadge`)

### 8. Casting confirmed / rejected

- [ ] Calendar reflects final state
- [ ] **If product requires rejected to vanish:** verify list filter; else verify **Rejected** badge is acceptable

### 9. Model path

- [ ] Model calendar (`getCalendarForModel` + booking events) matches allowed visibility (RLS)
- [ ] No forbidden commercial fields in model-facing overlays (booking brief scope / trust model — see `docs/BOOKING_BRIEF_SYSTEM.md`)

### 10. Event detail view

- [ ] Date/time correct for client/agency overlays
- [ ] Status/labels match current `option_requests` + `calendar_entries`
- [ ] After edits, detail matches server (re-fetch after save paths)

### 11. Rapid multi-update / race

- [ ] Quick accept/reject/counter/convert: no duplicate rows; eventual consistency after last `load*Calendar` completes
- [ ] Note: no per-row optimistic lock in calendar list — expect short-lived stale UI under extreme double-submit

---

## Sign-off

| Role | Name | Date | Notes |
|------|------|------|-------|
| QA / Owner | | | |
