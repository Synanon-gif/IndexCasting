# CURSOR_PAYWALL_DIFF_SUMMARY.md

| Datei | Zweck | Risiko | Testbezug |
|-------|--------|--------|-----------|
| `docs/PAYWALL_SECURITY_SUMMARY.md` | **Neu:** Verbindliche Paywall-/Subscription-Dokumentation | Kein Laufzeitrisiko | Manuell / Review |
| `.cursorrules` | §11 erweitert (org-weit, Owner-only, neue Gates, Stripe/DB) | Kein Laufzeitrisiko | — |
| `.cursor/rules/system-invariants.mdc` | Neuer Abschnitt PAYWALL & ORG-WIDE ACCESS | Kein Laufzeitrisiko | — |
| `.cursor/rules/auto-review.mdc` | Neuer Abschnitt **2c** Paywall/Subscription | Kein Laufzeitrisiko | — |
| `src/services/subscriptionSupabase.ts` | Kommentare/JSDoc: Entscheidungskette, fail-closed, Model vs B2B | **Minimal** — kein Logikwechsel | Bestehende [`subscriptionSupabase.test.ts`](src/services/__tests__/subscriptionSupabase.test.ts) |
| `CURSOR_PAYWALL_AUDIT_REPORT.md` | Audit-Artefakt | — | — |
| `CURSOR_PAYWALL_VERIFY.md` | Verifikationsmatrix | — | — |
| `CURSOR_PAYWALL_PLAN.json` | Maschinenlesbare Zusammenfassung | — | — |

**Nicht geändert:** `AuthContext.tsx`, `App.tsx`, SQL-Migrationen (kein Deploy), Edge Functions, Admin-RPC-Definitionen.
