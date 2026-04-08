# CURSOR_PAYWALL_VERIFY.md

Konkrete Prüfungen für Regressionen und Release-Checks. **Live-DB** nach SQL-Änderungen immer mit `pg_get_functiondef` / Policy-Queries abgleichen.

## A. `can_access_platform()` / RPC

| # | Prüfung | Erwartung |
|---|---------|-----------|
| A1 | User mit Org, `admin_overrides.bypass_paywall = true` | JSON `allowed: true`, `reason: admin_override` |
| A2 | Kein Override, `trial_ends_at > now()`, Email nicht in `used_trial_emails` für andere Org | `allowed: true`, `reason: trial_active` |
| A3 | Trial aktiv, aber Email-Hash bereits für **andere** Org in `used_trial_emails` | `allowed: false`, `reason: trial_already_used` |
| A4 | Trial abgelaufen, `status IN ('active','trialing')` | `allowed: true`, `reason: subscription_active` |
| A5 | Trial abgelaufen, Status `past_due` oder `canceled` | `allowed: false` (kein Match auf subscription_active) |
| A6 | Kein `organization_members` für User | `allowed: false`, `reason: no_org` |
| A7 | RPC-Fehler / Netzwerk in Frontend | `getMyOrgAccessStatus` fail-closed (`allowed: false`) — Logs prüfen |

## B. Checkout (Owner)

| # | Prüfung | Erwartung |
|---|---------|-----------|
| B1 | Owner ruft `create-checkout-session` auf | 200 mit `checkout_url` (wenn Stripe konfiguriert) |
| B2 | Booker/Employee (nicht owner) | 403 „Only the organization owner…“ |
| B3 | Falscher `org_id` / keine Membership | 422 / 403 je nach Implementierung |

## C. UI (ohne Auth-Dateien zu ändern — bestehende Prüfung)

| # | Prüfung | Erwartung |
|---|---------|-----------|
| C1 | Client-Org, `isBlocked` | `ClientPaywallGuard` → `PaywallScreen` |
| C2 | Agency-Org, `isBlocked` | `AgencyPaywallGuard` → `PaywallScreen` |
| C3 | Nicht-Owner auf Paywall | Keine Checkout-Buttons; Non-Owner-Hinweis |
| C4 | Admin-User | Admin-Dashboard vor Role-Gate (bestehendes Routing) |

## D. RLS / Policies (Stichprobe)

| # | Prüfung | Erwartung |
|---|---------|-----------|
| D1 | Policy „Clients see visible model photos“ | Enthält `has_platform_access()` (siehe `20260426_remediation…`) |
| D2 | `get_models_by_location` / Near-Me-Stack | `can_access_platform()` oder äquivalent dokumentierter Guard |

## E. Stripe ↔ DB

| # | Prüfung | Erwartung |
|---|---------|-----------|
| E1 | Webhook schreibt `organization_subscriptions` | Status/Plan konsistent mit Dashboard |
| E2 | Kein Cross-Org `stripe_subscription_id` | Webhook `checkSubscriptionLinking` greift |

## F. Fail-closed Frontend

| # | Prüfung | Erwartung |
|---|---------|-----------|
| F1 | Simulierter `can_access_platform`-Fehler im Client | Paywall / blocked, kein „free access“ |
