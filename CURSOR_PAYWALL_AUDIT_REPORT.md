# CURSOR_PAYWALL_AUDIT_REPORT.md

## 1. Executive Summary

Das Paywall-System ist in **`public.can_access_platform()`** (Migration [`20260416_fix_a_can_access_platform_sha256.sql`](supabase/migrations/20260416_fix_a_can_access_platform_sha256.sql)) zentral definiert: **admin_override → trial_active (mit `used_trial_emails`) → subscription_active (`active`/`trialing`) → deny**. **`has_platform_access()`** wrappt das Ergebnis für RLS/Policies und ausgewählte RPCs. **Stripe** schreibt via **`stripe-webhook`** in **`organization_subscriptions`**; **Checkout** läuft über **`create-checkout-session`** mit **Owner-only**-Pflicht. Das Frontend spiegelt den Status über **`SubscriptionContext`** / **`getMyOrgAccessStatus()`** und zeigt **`PaywallScreen`** bei Block — **keine Auth-/App.tsx-/Login-Änderungen** in dieser Runde.

Umsetzung dieser Audit-Runde: **Dokumentation** ([`docs/PAYWALL_SECURITY_SUMMARY.md`](docs/PAYWALL_SECURITY_SUMMARY.md)), **Cursor-Regeln** (`.cursorrules`, `system-invariants.mdc`, `auto-review.mdc`), **präzisierende Kommentare** in [`src/services/subscriptionSupabase.ts`](src/services/subscriptionSupabase.ts). **Keine** neuen SQL-Migrationen, **keine** Änderungen an `AuthContext.tsx`, `App.tsx`, Admin-Identitäts-RPCs oder `get_my_org_context()`-Semantik.

**Abschlusslabel:** `PARTIAL PAYWALL HARDENING APPLIED`

---

## 2. Ist-Architektur der Paywall

| Komponente | Rolle |
|------------|--------|
| `can_access_platform()` | JSONB mit `allowed`, `reason`, `plan`, `org_type`, ggf. `trial_ends_at`; löst Org über `organization_members` + `organizations`, älteste Membership |
| `has_platform_access()` | Boolean für Policies/SQL (Wrapper um JSONB `allowed`) |
| `organization_subscriptions` | Trial-Ende, Stripe-IDs, `status`, `plan` |
| `admin_overrides` | `bypass_paywall`, `custom_plan` pro Org |
| `used_trial_emails` | Verhindert Trial-Reset über neue Orgs (Email-Hash) |
| `create-checkout-session` | JWT → Membership; optional `org_id`; **nur `role === 'owner'`** |
| `stripe-webhook` | Signatur, Upsert, Subscription-Linking-Schutz |
| `SubscriptionContext` | UI-Spiegelung, Refresh |
| `ClientPaywallGuard` / `AgencyPaywallGuard` (`App.tsx`) | Full-app-lock für Client/Agency bei `isBlocked` |
| `PaywallScreen` | Owner-only Checkout-CTAs; Non-Owner Hinweis |
| `assertPlatformAccess` (`modelsSupabase`, `clientDiscoverySupabase`) | Zusätzlicher RPC-Check vor breiten Reads |

---

## 3. Org-Kontext-Auflösung

- **Paywall-RPC:** `auth.uid()` → `organization_members` JOIN `organizations`, **`ORDER BY om.created_at ASC LIMIT 1`**. Kein vom Client übergebener Org-Parameter in `can_access_platform()`.
- **Checkout:** Gleiche Membership-Tabelle; mit `body.org_id` wird die Query auf diese Org gefiltert — **kein** Checkout ohne Membership-Zeile; **Owner-Rolle** zusätzlich.
- **Frontend-Hilfen** (`getMyOrgSubscription`, `getMyAdminOverride`): `LIMIT 1` auf ältester Membership — konsistent mit Paywall-Scope (Med-04-Kommentar im Code).

---

## 4. Owner-only vs org-weiter Zugriff

| Thema | Server | UI |
|--------|--------|-----|
| Org-weiter Zugriff | `can_access_platform` gilt für die **aufgelöste Org** — alle Mitglieder teilen sich den Status | `isBlocked` für alle Rollen derselben Org |
| Billing / Checkout | `create-checkout-session`: `role === 'owner'` | `PaywallScreen`: `org_member_role === 'owner'` für CTAs |
| Invite / Org delete / Member-Management | Nicht Gegenstand dieser Migration-Runde; weiterhin Owner-exklusiv laut Produktregeln und separaten RPCs/UI | `AgencyControllerView` etc. |

---

## 5. Confirmed Findings (klassifiziert)

| ID | Klassifizierung | Befund |
|----|-----------------|--------|
| F1 | **NO_ISSUE** | Entscheidungskette in `20260416_fix_a_can_access_platform_sha256.sql` entspricht der verbindlichen Reihenfolge in `.cursorrules` §11. |
| F2 | **NO_ISSUE** | Checkout Owner-only serverseitig in `create-checkout-session/index.ts` (403 bei Nicht-Owner). |
| F3 | **LOW** | Multi-Org-Nutzer: überall dieselbe „älteste Membership“-Semantik — dokumentiert, kein Org-Switching-Produkt. |
| F4 | **MANUAL_REVIEW_REQUIRED** | `getMyOrgAccessStatus()` mappt **alle** Fehler auf `reason: 'no_org'` (fail-closed korrekt; Unterscheidung Transport vs. echtes `no_org` für UX/Observability optional). |
| F5 | **MANUAL_REVIEW_REQUIRED** | `past_due` / `canceled` in DB vs. `can_access_platform` nur `active`/`trialing` — beabsichtigt harte Paywall; Produkt/Stripe-Recovery-Flows explizit gegen Kundenwunsch prüfen. |
| F6 | **LOW** | `has_platform_access` in `migrations/` nur an wenigen Stellen referenziert; viele historische Definitionen liegen außerhalb `migrations/` — **Live-DB** als Maßstab (siehe Drift-Doku). |
| F7 | **NO_ISSUE** | Model-Rolle ohne `organization_members`-Agency-Link: Paywall-RPC liefert `no_org`; Model-UI nicht über dieselben Paywall-Guards wie B2B — mit Fix H konsistent (siehe Summary-Dok). |

---

## 6. Manual Review Required

- Vollständige Matrix: **welche** RPCs/INSERT-Pfade für org-kritische Daten haben **keinen** `has_platform_access()`-Check — Absicht (z. B. Model) vs. Lücke.
- Ob **`trial_ends_at > now()`** und gleichzeitig Stripe-`status` ein anderes Signal senden kann — Abgleich mit Webhook-Updates in Langzeitläufen.
- Live-`pg_get_functiondef` für **`has_platform_access`** falls nicht aus letzter Migration rekonstruierbar.

---

## 7. Umgesetzte sichere Härtungen

- [`docs/PAYWALL_SECURITY_SUMMARY.md`](docs/PAYWALL_SECURITY_SUMMARY.md) — verbindliche technische + Produktregeln.
- [`.cursorrules`](.cursorrules) §11 — Org-weit, Owner-only, neue gated Funktionen.
- [`.cursor/rules/system-invariants.mdc`](.cursor/rules/system-invariants.mdc) — Paywall-Invarianten.
- [`.cursor/rules/auto-review.mdc`](.cursor/rules/auto-review.mdc) — Checkliste 2c.
- [`src/services/subscriptionSupabase.ts`](src/services/subscriptionSupabase.ts) — Modul- und JSDoc-Kommentare (Entscheidungskette, fail-closed-Semantik, Model vs B2B).

---

## 8. Warum Admin-/Login-Pfad unberührt blieb

Keine Änderungen an `AuthContext.tsx`, `App.tsx`, `signIn`, `bootstrapThenLoadProfile`, `loadProfile`, `get_own_admin_flags`, `is_current_user_admin`, `assert_is_admin`, Admin-Routing oder Invite-/Claim-Kernnavigation — ausschließlich Doku, Regeln und Kommentare in `subscriptionSupabase.ts`.

---

## 9. Nächste sichere Schritte

1. Live-DB: `pg_get_functiondef` für `can_access_platform` und `has_platform_access` verifizieren.
2. Optional: dedizierten `AccessReason` oder Metadaten für RPC-Fehler — nur nach Produktentscheid (kein silent Behavior-Change).
3. Bei neuen Features: Abschnitt **2c** in `auto-review.mdc` abarbeiten.
