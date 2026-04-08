# CURSOR_BOOKING_BRIEF_DIFF_SUMMARY

| File | Purpose | Risk | Tests |
|------|---------|------|--------|
| `src/utils/bookingBrief.ts` | Types, parse, filter, merge for `booking_brief` | Low — pure logic | `src/utils/__tests__/bookingBrief.test.ts` |
| `src/services/calendarSupabase.ts` | `BookingDetails.booking_brief` type | Low | Indirect |
| `src/components/BookingBriefEditor.tsx` | Shared UI + save via `updateBookingDetails` | Low — same write path as notes | Manual |
| `src/constants/uiCopy.ts` | `bookingBrief` + calendar note strings | Low | — |
| `src/views/AgencyControllerView.tsx` | Embed editor + uiCopy for notes | Low | Manual |
| `src/web/ClientWebApp.tsx` | Embed editor + uiCopy | Low | Manual |
| `src/screens/ModelProfileScreen.tsx` | Embed editor + uiCopy | Low | Manual |
| `docs/BOOKING_BRIEF_SYSTEM.md` | Feature doc | None | — |
| `docs/OPTION_CASTING_FLOW.md` | §9 + code map | None | — |
| `.cursor/rules/auto-review.mdc` | One additive bullet | None | — |
| `CURSOR_BOOKING_BRIEF_*` | Report / verify / plan | None | — |

**No** SQL migrations, **no** auth/paywall/RLS changes.
