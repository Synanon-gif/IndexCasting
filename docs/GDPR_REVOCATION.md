# GDPR — Revocation & withdrawal (Art. 7)

## Consent withdrawal

- **`withdraw_consent(p_consent_type, p_reason)`** — updates `consent_log` and writes audit via `log_audit_action` (see [`20260420_gdpr_rpc_row_security_account_delete_membership.sql`](../supabase/migrations/20260420_gdpr_rpc_row_security_account_delete_membership.sql)).
- Marketing/analytics: UI should align with backend enforcement for email/analytics (provider-side where applicable).

## Guest links (external packages)

- **`revoke_guest_access(p_link_id)`** — sets link inactive and audit trail; see [`migration_compliance_hardening_2026_04.sql`](../supabase/migration_compliance_hardening_2026_04.sql).
- **Expiry**: enforced in guest-link read RPCs (e.g. `expires_at`, first-access window) — see guest-link migrations under `supabase/migrations/`.

## Invitations

- Pending invitations can be removed by the **org owner** (policies/migrations for `invitations`); expired/used tokens must not be reusable — enforced at acceptance RPCs. A dedicated `revokeInvite(tokenId)` RPC is optional product scope; owner-delete of pending invites is the baseline.

## Sessions

- **Account deletion** invalidates the user in Supabase Auth; existing JWTs expire naturally by TTL.
- **Global “logout all devices”** for a living account is a **product** feature (refresh token revocation / password rotate) — not duplicated here; Supabase Auth supports patterns documented in Supabase docs.
