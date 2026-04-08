# Cursor Rules — Paywall / Billing / Stripe (additive Update)

Dokumentiert **nur** die ergänzten Abschnitte (April 2026). Bestehende Regeln wurden nicht umgeschrieben oder entfernt.

## Geänderte Dateien

| Datei | Ergänzung |
|-------|-----------|
| `.cursorrules` | `### PAYWALL INVARIANTS (STRICT)` und `### FAIL-CLOSED PAYWALL` unter §11 Paywall |
| `.cursor/rules/system-invariants.mdc` | `### PAYWALL INVARIANTS (STRICT)` und `### ORG-KONTEXT (Paywall / Billing — deterministische Membership)` |
| `.cursor/rules/auto-review.mdc` | Erweiterung §2c (Paywall-Ausnahme Risiko 10/Q7), `### STRIPE & BILLING SAFETY`, `### STRIPE GO-LIVE REQUIREMENT` |
| `.cursor/rules/dev-workflow.mdc` | `### STRIPE & BILLING SAFETY`, `### OWNER BILLING UX RULE` |

## Warum

- **Ein gefrorener Vertrag** zwischen Produkt, DB (`can_access_platform`) und Stripe (Webhooks) — damit Refactors die bewusst gewählte Trennung „Zahlung vs. Zugriff“ nicht aushebeln.
- **Owner-only Billing** und **org-weite Paywall** sind leicht verwechselbar mit „User-Plan“ oder Frontend-Caches; die Zusätze machen die Grenzen explizit.
- **Fail-closed** verhindert, dass UI oder Hilfsfunktionen bei RPC-/Netzwerkfehlern fälschlich „Zugriff gewährt“.

## Verhinderte Risiken (Kurz)

- Frontend als finale Paywall-Instanz; optimistisches Freischalten bei Fehlern.
- Checkout oder schreibende Billing-Aktionen durch Booker/Employee.
- Abweichende oder duplizierte Logik in `has_platform_access()` statt `can_access_platform()`.
- Umstellung der Prioritätskette ohne Review.
- Stripe-Live-Deploy ohne Abprüfung von Rollen, Zuständen und Webhook→DB→UI.
- Verallgemeinerung der Paywall-„eine Membership-Zeile“-Logik auf beliebige Org-Features (Konflikt mit Multi-Org-/Caller-Resolution-Regeln).

## Hinweis

Auth-, Admin- und RLS-Kernregeln wurden **nicht** angefasst. Für operative Checks weiterhin `docs/PAYWALL_SECURITY_SUMMARY.md` und `CURSOR_PAYWALL_VERIFY.md` nutzen.
