# Calendar interop — audit report (2026-04-16)

This document records the **end-to-end audit** of private ICS export, subscription feed, Edge Function, DB RPCs, and UI entry points. It complements [GDPR_EXPORT_CALENDAR_QA.md](./GDPR_EXPORT_CALENDAR_QA.md).

## 1. File / function inventory

| Layer | Path / name |
|-------|-------------|
| **Migration (canonical)** | `supabase/migrations/20260823_calendar_feed_token_and_anonymize_fix.sql` — token + export RPCs; **`20260901_calendar_export_events_json_include_booking_events.sql`** — `calendar_export_events_json` merges **`booking_events`** with dedupe parity to `src/constants/calendarSourcePriority.ts` |
| **Related schema / export** | `supabase/migrations/20260822_gdpr_export_user_data_fix_user_calendar_events.sql` (column precheck for `user_calendar_events`) |
| **Edge** | `supabase/functions/calendar-feed/index.ts`, `supabase/functions/calendar-feed/ics.ts` |
| **Client service** | `src/services/calendarFeedSupabase.ts` |
| **ICS builder (app)** | `src/utils/icsCalendar.ts` |
| **Tests** | `src/utils/__tests__/icsCalendar.test.ts`, `src/services/__tests__/calendarFeedSupabase.test.ts` |
| **UI** | `src/screens/ModelProfileScreen.tsx`, `src/components/AgencySettingsTab.tsx`, `src/web/ClientWebApp.tsx` (`SettingsPanel`) |
| **App calendar (parity reference)** | `src/services/calendarSupabase.ts`, `src/services/userCalendarEventsSupabase.ts` |

**Live DB verification:** Re-run after deploy: `GRANT`/`REVOKE` on `get_calendar_feed_payload(text)` → `service_role` only; `calendar_export_events_json(uuid)` → no `EXECUTE` for `anon`/`authenticated` (internal only). Use Management API or SQL `information_schema` / `pg_proc` proacl as needed.

## 2. Data flow architecture

1. **Authenticated .ics download:** `get_calendar_export_payload_for_me()` → `auth.uid()` → `calendar_export_events_json(uid)` → client `icsEventsFromExportPayload` → `buildIcsCalendar`.
2. **Subscription feed:** User calls `rotate_calendar_feed_token()` → plaintext token once in JSON; only SHA-256 hex stored on `profiles`. Edge `GET calendar-feed?token=` → service role → `get_calendar_feed_payload(token)` → hash match → same `calendar_export_events_json(uid)`.
3. **Revoke:** `revoke_calendar_feed_token()` sets `calendar_feed_token_hash = NULL`; feed RPC returns empty `events` for any token (no user enumeration).

**Source tables in `calendar_export_events_json`:**

- **`booking_events`:** non-cancelled rows visible to the subject (creator, linked model user, member of `client_org_id` or `agency_org_id` org) — same visibility intent as GDPR export subset.
- `user_calendar_events`: rows where `owner_id = p_user_id` OR `created_by = p_user_id` OR (`organization_id` set and user is in `organization_members`). **Multi-org:** all orgs the user belongs to contribute events (org-wide manual/mirrored events).
- `calendar_entries`: non-cancelled rows where the user is the linked model **or** appears on `option_requests` as `client_id`, `created_by`, `booker_id`, `agency_assignee_user_id`, or linked model user.

**Parity note (UI vs export):** Dedupe partition `opt:<option_request_id>` + numeric `sourcePriority` (0 = `booking_events` … 4 = manual `user_calendar_events`) matches `src/constants/calendarSourcePriority.ts` and `icsEventsFromExportPayload` tie-breaks. In-app unified agency calendar still applies **active representation** filters in `calendarSupabase.ts` / `modelRepresentationGuards.ts` where the export is user-scoped only.

## 3. Security assessment

| Check | Result |
|-------|--------|
| Cross-user leak via feed | **Mitigated:** token hashed; wrong token → empty events; short token → Edge 404 before RPC |
| Plaintext token in DB | **No** — only hash |
| `get_calendar_feed_payload` exposed to clients | **No** — `EXECUTE` only `service_role` (per migration) |
| Error bodies leak secrets | Edge returns generic `Not found` / `Service unavailable`; details only in `console.error` |
| Enumeration | Long invalid token → empty calendar (200) — intentional to avoid user oracle; tradeoff documented in plan |

## 4. ICS / RFC 5545 (code review)

- **Client vs Edge:** `ics.ts` and `icsCalendar.ts` implement the same `eventToDtStartDtEnd` / folding / escaping logic (diff is comments/formatting only).
- **All-day:** `DTSTART;VALUE=DATE` + `DTEND;VALUE=DATE` next day (exclusive end).
- **Timed:** Floating `DTSTART/DTEND` without `Z` / `TZID` — subscriber local timezone applies (documented in `icsCalendar.ts`).
- **Optional fields:** `LOCATION` not emitted — DB payload has no location field today.
- **DESCRIPTION:** `user_calendar_events` uses `note`; `calendar_entries` uses `client_name` only — limited but consistent with SQL.

**Manual client QA (required for Go-Live):** Import `.ics` and subscribe via HTTPS + `webcal://` in **Google Calendar** and **Apple Calendar**; verify title, time, description, and floating-time behavior.

## 5. Edge Function (`calendar-feed`)

- **Method:** GET only; OPTIONS for CORS.
- **Token:** trim; length &lt; 16 → 404 (aligns with SQL treating short token as empty).
- **Response:** `Content-Type: text/calendar; charset=utf-8`; `Cache-Control: private, max-age=300`.
- **CORS:** Allowlist for browser origins; calendar fetchers often omit `Origin` — typically unaffected.

## 6. UI review

| Location | Download .ics | Feed rotate / revoke | Busy state | Web-only guard |
|----------|---------------|----------------------|------------|----------------|
| Model profile | Yes (web only) | Alert + clipboard (web) | `calendarIcsBusy` / `calendarFeedBusy` / `calendarRevokeBusy` | Yes for .ics |
| Agency settings | Same | Same | Same | Yes for .ics |
| Client Web settings | Yes (panel is web) | Same | Same | N/A |

**Rotate:** New token invalidates previous hash immediately. **Revoke:** UI confirms before destructive action.

## 7. Automated tests added / updated

- `src/utils/__tests__/icsCalendar.test.ts` — `HH:MM:SS`, Unicode summary/cal name, multi-event order, payload null times.
- `src/services/__tests__/calendarFeedSupabase.test.ts` — rotate/revoke/download/URL helpers with mocked `supabase` and `config/env`.

No SQL or Deno integration tests in CI (per plan: avoid flaky live DB in default pipeline).

## 8. Fixes applied (minimal)

| Issue | Severity | Fix |
|-------|----------|-----|
| `downloadCalendarIcsFile` returned `{ ok: true }` when `document`/`Blob` unavailable (e.g. Node or non-browser) | S3 | Return `{ ok: false, reason: 'download_not_available' }` unless download actually runs — `src/services/calendarFeedSupabase.ts` |

No migration or lifecycle/trigger changes.

## 9. Manual QA checklist (fill in results)

### Per role

- [ ] **Model (web):** Privacy → Download calendar (.ics) → open in Apple/Google; Create subscription link → paste HTTPS URL; repeat with `webcal://`; Revoke → old URL shows empty calendar; Rotate → old URL empty, new URL has events.
- [ ] **Booker / Agency (web):** Same from Agency settings.
- [ ] **Employee / Client (web):** Same from Client Web settings panel.
- [ ] **Admin:** Same as whichever workspace they use; confirm no other users’ events appear.
- [ ] **Multi-org user:** Confirm exported events match expectation (all member orgs’ `user_calendar_events` per SQL).
- [ ] **User with zero events:** Empty `VCALENDAR` / no errors.

### Real clients

- [ ] Apple Calendar — import file + subscribe by URL.
- [ ] Google Calendar — import + From URL.
- [ ] Verify title, start/end, description, timezone interpretation (floating local).
- [ ] Revoked link stops updating / shows no private data.
- [ ] Rotated link: old token never shows new data.

## 10. Residual risks

- Floating local times vs. fixed “agency timezone” expectation.
- Possible **duplicate** VEVENTs if the same logical booking appears in both `user_calendar_events` and `calendar_entries` with different ids (Stichprobe mit Produktionsdaten). **Mitigation today:** SQL `ROW_NUMBER` partition `opt:<option_request_id>` + `sourcePriority` (`booking_events`=0 wins) in `calendar_export_events_json` (Migration `20260901`), gespiegelt in `src/constants/calendarSourcePriority.ts` und `icsEventsFromExportPayload`. **Restrisiko:** Buchungen ohne `option_request_id` (z. B. ad-hoc `booking_events` ohne verlinktes Option-Request) können nicht via `opt:`-Partition dedupliziert werden — Stichprobe mit Produktionsdaten empfohlen, falls in Zukunft solche Rows erwartet werden.
- ~~`booking_events` not in export (see §2)~~ — **erledigt** mit Migration `20260901_calendar_export_events_json_include_booking_events.sql`: `booking_events` werden inkludiert (Sichtbarkeit: Creator, verlinktes Model-User, Org-Mitgliedschaft `client_org_id` / `agency_org_id`) und in der Dedupe-Partition mit höchster Priorität (`sourcePriority = 0`) gemerged. Siehe §1, §2 (Source tables) und `src/utils/icsCalendar.ts` Tie-break.
- Calendar clients may cache feed up to `max-age=300` after revoke.

## 11. Update log

- **2026-04-17:** §10 aktualisiert — `booking_events not in export` als erledigt markiert (Migration `20260901_calendar_export_events_json_include_booking_events.sql` + `src/constants/calendarSourcePriority.ts` + `src/utils/icsCalendar.ts` Tie-break belegen die Inklusion). Duplikat-Restrisiko klarer formuliert (Mitigation via SQL `ROW_NUMBER` + sourcePriority). Verbleibendes Restrisiko: ad-hoc `booking_events` ohne `option_request_id`.

## 12. Production readiness

**Go / No-Go:** **Conditional Go** after **manual §9** passes on staging/production URL, Edge `calendar-feed` deployed with secrets, and migrations `20260822_*` + `20260823_*` applied. Automated tests and static audit alone are **not** sufficient for final sign-off.

---

*Report generated as part of Calendar Interop E2E audit; do not treat Root-only `supabase/*.sql` as deploy truth — use `supabase/migrations/` and live DB verification.*
