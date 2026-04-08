# CURSOR_STRIPE_LIVE_DIFF_SUMMARY.md

| File | Purpose | Risk | Tests |
|------|---------|------|--------|
| [`docs/STRIPE_LIVE_GO_LIVE_CHECKLIST.md`](docs/STRIPE_LIVE_GO_LIVE_CHECKLIST.md) | Operational go-live steps, secrets, roles, Go/No-Go | None | Manual |
| [`docs/STRIPE_LIVE_VERIFY_MATRIX.md`](docs/STRIPE_LIVE_VERIFY_MATRIX.md) | Final smoke/verify matrix | None | Manual |
| [`.env.example`](.env.example) | Stripe / `APP_URL` placeholder comments (no secrets) | None | n/a |
| [`CURSOR_STRIPE_LIVE_READINESS_REPORT.md`](CURSOR_STRIPE_LIVE_READINESS_REPORT.md) | Audit summary and verdict | None | n/a |
| [`CURSOR_STRIPE_LIVE_PLAN.json`](CURSOR_STRIPE_LIVE_PLAN.json) | Machine-readable checklist | None | n/a |

**Unchanged:** `AuthContext.tsx`, `App.tsx`, `create-checkout-session` logic, `stripe-webhook` logic, `can_access_platform()` SQL, SubscriptionContext.
