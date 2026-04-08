# Data retention policy (documentation)

**Status:** Policy description only — **no automated deletion jobs** are required by this document unless separately scheduled (e.g. `gdpr_purge_*` in compliance migrations).

## Labels

| Label | Meaning |
|-------|---------|
| **Legal retention** | Minimum or required storage period for tax, accounting, or similar obligations — shortening only after legal review. |
| **Business retention** | Kept for operations, disputes, or product function — no automatic expiry in-app unless a separate job is introduced. |
| **No automatic deletion** | Rows are not removed by a scheduled app job; deletion follows account/org flows or manual admin where applicable. |

## Categories (durations where known)

| Category | Typical duration / rule | Label |
|----------|-------------------------|--------|
| **Messages / option & recruiting chats** | Life of org relationship + dispute window (not a fixed TTL in DB) | Business retention — no automatic deletion |
| **Booking / calendar metadata** | Operational life of booking; `booking_details` JSON is UI-filtered — see [`BOOKING_BRIEF_SYSTEM.md`](./BOOKING_BRIEF_SYSTEM.md) | Business retention — no automatic deletion |
| **Invoices / billing** | Statutory (e.g. multi-year) per jurisdiction — Stripe + ledger | Legal retention |
| **Audit / security** | e.g. `audit_trail` ~7 years, `security_events` ~2 years in compliance migrations (verify live) | Legal / policy retention |
| **Deleted users** | Anonymization paths in RPCs; auth row removed via Edge | Mixed — see [`GDPR_DELETE_FLOW.md`](./GDPR_DELETE_FLOW.md) |

## Catalog hints

PostgreSQL `COMMENT ON TABLE` for `messages` and `calendar_entries` points here for **visibility** only — **not** enforced by triggers or cron in this repo unless separately added.

Review with legal counsel before shortening retention for categories with statutory minimums.
