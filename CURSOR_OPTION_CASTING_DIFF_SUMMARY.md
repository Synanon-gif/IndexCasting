# CURSOR_OPTION_CASTING_DIFF_SUMMARY

| File | Purpose | Risk | Tests |
|------|---------|------|--------|
| `src/store/optionRequests.ts` | Populate `client_organization_id` + `agency_organization_id` on new option requests (org-centric consistency with RLS/listing). | Low — same values DB would infer for typical orgs; nullable if lookup fails. | Existing store/service tests; manual verify insert path. |
| `src/utils/calendarColors.ts` | Export `OPTION_REQUEST_CHAT_STATUS_COLORS` for Messages tab pills (shared Client/Agency). | Low — visual parity only. | `calendarColors.test.ts` |
| `src/web/ClientWebApp.tsx` | Use shared colors + `uiCopy` for option status labels. | Low. | Lint/typecheck; UI smoke. |
| `src/views/AgencyControllerView.tsx` | Same as ClientWebApp for agency Messages list. | Low. | Lint/typecheck; UI smoke. |
| `src/components/GlobalSearchBar.tsx` | Replace bare `—` with `uiCopy` for missing model name in search results. | Low. | Manual search. |
| `src/views/ModelView.tsx` | Unnamed model + Option/Casting labels from `uiCopy`. | Low. | Manual model inbox. |
| `src/constants/uiCopy.ts` | New strings for statuses + unnamed model. | Low — English-only central copy. | N/A |
| `src/utils/__tests__/calendarColors.test.ts` | Assert color helpers. | None. | `npm test` |
| `docs/OPTION_CASTING_FLOW.md` | Technical product/engineering reference. | None (docs only). | N/A |
| `CURSOR_OPTION_CASTING_*.md` / `.json` | Audit + verify artifacts. | None. | N/A |

**Not changed:** `AuthContext.tsx`, `App.tsx`, paywall core, admin SQL/RPCs, migrations (no new SQL in this batch).
