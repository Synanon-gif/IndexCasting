# CURSOR_SECURITY_FINAL_HARDENING_VERIFY

Manual checklist after deploy (client-only; no Supabase SQL required).

## Text & limits

- [ ] Org messenger: send a normal message; send a message with only zero-width/invisible chars (should fail or collapse as before).
- [ ] Recruiting booking chat: send twice rapidly; second send within ~400 ms should not duplicate (debounce).
- [ ] Shared booking note (agency / client / model): append a note; rapid double-click should not create duplicate notes within debounce window.
- [ ] Shared booking note over 4000 chars (after normalization): should not persist (service returns false).

## URLs

- [ ] Booking chat: open an image/file attachment (signed HTTPS URL) — should open.
- [ ] Checkout (owner): start checkout from billing card / paywall — Stripe URL should open; invalid URL should show error, not open.
- [ ] Terms / Privacy: “View latest version online” opens HTTPS legal URL when valid.

## Agency model save

- [ ] Save model with long name/city strings — values should clamp without breaking save for normal lengths.

## Regression

- [ ] Login all roles still works (unchanged code paths).
- [ ] `mailto:` contact links still work (not passed through `validateUrl`).

## Automated

- [ ] `npm run typecheck && npm run lint && npm test -- --passWithNoTests --ci` — all green.
