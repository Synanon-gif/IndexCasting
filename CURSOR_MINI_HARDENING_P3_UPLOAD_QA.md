# P3 — Upload QA (Mini Hardening)

## Code spotcheck (automated)

`convertHeicToJpegWithStatus` / `convertHeicToJpegIfNeeded` from [`src/services/imageUtils.ts`](src/services/imageUtils.ts) are used in:

- Model photos: [`modelPhotosSupabase.ts`](src/services/modelPhotosSupabase.ts), [`ModelMediaSettingsPanel.tsx`](src/components/ModelMediaSettingsPanel.tsx)
- Chat: [`messengerSupabase.ts`](src/services/messengerSupabase.ts), [`recruitingChatSupabase.ts`](src/services/recruitingChatSupabase.ts)
- Option documents: [`optionRequestsSupabase.ts`](src/services/optionRequestsSupabase.ts)
- Other browser uploads: [`documentsSupabase.ts`](src/services/documentsSupabase.ts), [`verificationSupabase.ts`](src/services/verificationSupabase.ts), [`applicationsSupabase.ts`](src/services/applicationsSupabase.ts), [`ApplyFormView.tsx`](src/views/ApplyFormView.tsx)

Callers that use `WithStatus` should surface UX when `conversionFailed === true` (see each call site).

## Device matrix (manual — required for PASS)

| Environment        | Scenario                         | Flows to try                          | Result |
|-------------------|-----------------------------------|----------------------------------------|--------|
| iPhone (Safari)   | HEIC                             | Model portfolio, Chat attachment       |        |
| Android           | JPG / PNG                        | Model portfolio, Chat                  |        |
| Desktop browser   | Drag & drop, large images        | Portfolio, Chat, Option documents      |        |

**Pass criteria:** No silent failure; user-visible error on invalid/failed HEIC conversion; successful uploads complete end-to-end.

**Agent status:** Code paths verified only — **device PASS/FAIL must be filled by a human**.
