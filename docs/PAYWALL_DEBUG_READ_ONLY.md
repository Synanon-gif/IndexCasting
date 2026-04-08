# Paywall debugging — read-only reference

Internal reference for interpreting **`can_access_platform()`** JSON and client-side mirroring. **No bypass instructions** — enforcement remains server-side (RLS, RPCs, Edge Functions).

**Related:** [PAYWALL_SECURITY_SUMMARY.md](./PAYWALL_SECURITY_SUMMARY.md) · [PAYWALL_TROUBLESHOOTING_GUIDE.md](./PAYWALL_TROUBLESHOOTING_GUIDE.md) · `src/services/subscriptionSupabase.ts`

---

## RPC: `can_access_platform()`

- **Parameters:** none — org is resolved inside the database from `auth.uid()` → `organization_members` (deterministic **oldest** membership row for this paywall scope).
- **Returns:** JSON object (exact keys live in migration; typical fields below).

### Typical JSON fields

| Field | Meaning |
|-------|---------|
| `allowed` | `true` / `false` — whether the org passes the platform gate. |
| `reason` | Why — see table below. |
| `plan` | Plan label or null (depends on row / override). |
| `trial_ends_at` | ISO timestamp or null. |
| `organization_id` | Resolved org UUID. |
| `org_type` | `'agency'` or `'client'` when present (from `organizations.type`). |

### `reason` values (conceptual)

| `reason` | Typical meaning |
|----------|-----------------|
| `admin_override` | `admin_overrides.bypass_paywall` for resolved org. |
| `trial_active` | Trial window valid and not blocked by `used_trial_emails` cross-org rule. |
| `subscription_active` | `organization_subscriptions.status` in `active` / `trialing`. |
| `trial_already_used` | Email hash already consumed trial on another org. |
| `no_active_subscription` | No trial/subscription path matched. |
| `no_org` | No usable `organization_members` row for caller (B2B paywall scope). |

Exact enum is defined in DB and mirrored in TypeScript `AccessReason` in `subscriptionSupabase.ts`.

---

## Client mirror: `getMyOrgAccessStatus()`

- Calls `supabase.rpc('can_access_platform')` with **no** org argument.
- **Fail-closed:** on RPC error or exception, returns `allowed: false` and `reason: 'no_org'`. That `reason` is a **UI sentinel** for “blocked / unknown” — it does **not** distinguish transport errors from a user with no membership. Use **logs** (`[subscription] getMyOrgAccessStatus error:`) for diagnosis.

---

## Wrapper: `has_platform_access()`

SQL helper: boolean derived from `can_access_platform()` for policies and some RPCs — same decision order as the JSON RPC.

---

## Model role (out of scope for this RPC’s org)

Users with `role === model` often have **no** `organization_members` row for agency linkage. `can_access_platform()` may return `no_org` for them. Model workspace routing is **not** the same as Client/Agency B2B paywall guards — see security summary §“Model role vs B2B paywall”.
