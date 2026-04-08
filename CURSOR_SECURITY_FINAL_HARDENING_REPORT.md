# CURSOR_SECURITY_FINAL_HARDENING_REPORT

**Scope:** Client-side defense-in-depth after Security Audit E. No RLS, Auth, Paywall, Invite, Claim, or migration changes.

## What was improved

1. **Central limits** ([`lib/validation/limits.ts`](lib/validation/limits.ts)): `MESSAGE_MAX_LENGTH`, `SHARED_BOOKING_NOTE_MAX_LENGTH`, model text caps, `UI_DOUBLE_SUBMIT_DEBOUNCE_MS`. Re-exported from [`lib/validation/index.ts`](lib/validation/index.ts).

2. **Messenger UI** ([`src/components/OrgMessengerInline.tsx`](src/components/OrgMessengerInline.tsx)): `normalizeInput` before `validateText`, using `MESSAGE_MAX_LENGTH`.

3. **Recruiting / booking chat** ([`src/views/BookingChatView.tsx`](src/views/BookingChatView.tsx)): `validateUrl` before `Linking.openURL` for attachments; `UI_DOUBLE_SUBMIT_DEBOUNCE_MS` to reduce double-send.

4. **Services** ([`messengerSupabase.ts`](src/services/messengerSupabase.ts), [`recruitingChatSupabase.ts`](src/services/recruitingChatSupabase.ts), [`optionRequestsSupabase.ts`](src/services/optionRequestsSupabase.ts)): Magic `2000` replaced with `MESSAGE_MAX_LENGTH`.

5. **Calendar / booking_details** ([`src/services/calendarSupabase.ts`](src/services/calendarSupabase.ts)): `appendSharedBookingNote` uses `normalizeInput` → `validateText` (shared note max) → `sanitizeHtml` + clamp; `asBookingDetails()` for safe merge in `appendSharedBookingNote` and `updateBookingDetails`.

6. **Agency model save** ([`src/views/AgencyControllerView.tsx`](src/views/AgencyControllerView.tsx)): `normalizeInput` + length clamp for name, city, hair/eye/ethnicity, current_location before `agency_update_model_full`; geocode uses clamped `updates.city`.

7. **Shared selection URL params** ([`src/utils/queryParamGuards.ts`](src/utils/queryParamGuards.ts)): `stripInvisibleChars` + trim + length cap (full `normalizeInput` omitted here so length caps stay predictable).

8. **Checkout & legal HTTPS links** ([`OwnerBillingStatusCard.tsx`](src/components/OwnerBillingStatusCard.tsx), [`PaywallScreen.tsx`](src/screens/PaywallScreen.tsx), [`TermsScreen.tsx`](src/screens/TermsScreen.tsx), [`PrivacyScreen.tsx`](src/screens/PrivacyScreen.tsx)): `validateUrl` before `Linking.openURL` for HTTPS URLs.

9. **Shared booking note UI** ([`AgencyControllerView.tsx`](src/views/AgencyControllerView.tsx), [`ClientWebApp.tsx`](src/web/ClientWebApp.tsx), [`ModelProfileScreen.tsx`](src/screens/ModelProfileScreen.tsx)): Short debounce (`UI_DOUBLE_SUBMIT_DEBOUNCE_MS`) before posting.

## What is now consistently guarded (client-side)

- Text pipelines use shared limits where touched; chat services already normalized server-side; Org messenger aligns pre-check with `normalizeInput`.
- Shared booking notes: validation + sanitization + safe JSON object merge for `booking_details`.
- User-triggered HTTPS opens: validated where URLs are not static literals (checkout, legal external links, booking chat attachments).
- Double-submit: debounce on recruiting chat send and shared-note posts.

## What remains intentionally unchanged

- **`mailto:` `Linking.openURL`**: `validateUrl` is HTTPS-only; mailto flows unchanged by design.
- **Booking brief / `booking_details` trust model**: Still UI-filtered JSONB; no field-level RLS (see [`docs/BOOKING_BRIEF_SYSTEM.md`](docs/BOOKING_BRIEF_SYSTEM.md)).
- **Server authority**: All client checks are defense-in-depth; RLS and RPCs remain the source of truth.

**FINAL LINE:** FINAL HARDENING COMPLETE — SYSTEM CONSISTENT
