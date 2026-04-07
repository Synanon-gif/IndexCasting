# CURSOR_FIX_PLAN_TEST_MATRIX.md

**Legende:** **P** = Pflicht vor Merge der zugehörigen Maßnahme, **O** = optional empfohlen.  
**Maßnahme-IDs:** siehe [`CURSOR_FIX_PLAN.md`](CURSOR_FIX_PLAN.md) / [`CURSOR_FIX_PLAN.json`](CURSOR_FIX_PLAN.json).

---

## Test-IDs — Querschnitt (Pflicht-Blöcke)

### LOGIN (manuell oder E2E)

| Test-ID | Rolle / Flow | Typ | Zweck | P/O |
|---------|----------------|-----|-------|-----|
| T-LOGIN-ADMIN | Admin | manual login + e2e | `signIn` → AdminDashboard sichtbar | P für M-005,M-006,M-007,M-010,M-016 |
| T-LOGIN-AGENCY-OWNER | Agency owner | manual / e2e | Bootstrap + Agency-Shell | P für M-005,M-016 |
| T-LOGIN-AGENCY-BOOKER | Booker | manual / e2e | Gleichwertigkeit Owner/Booker | P für M-003,M-005 |
| T-LOGIN-CLIENT-OWNER | Client owner | manual / e2e | Org + Paywall-Gates | P für M-005 |
| T-LOGIN-CLIENT-EMP | Employee | manual / e2e | Gleichwertigkeit | P für M-003,M-005 |
| T-LOGIN-MODEL | Model | manual / e2e | Kein Org-RPC-Zwang | P für M-008,M-016 |
| T-LOGIN-GUEST | Guest | manual / e2e | Gast-Routing | P für M-016 |
| T-INVITE-001 | Invite | integration / e2e | Accept nach Sign-In Step 2 | P für M-008 |
| T-CLAIM-001 | Model claim | integration / e2e | Token claim isoliert | P für M-008 |
| T-FEAT-ADMIN-RPC-001 | Admin | integration | `admin_get_profiles` o.ä. nach DB-Änderung | P für M-007 |

### AUTH / PROFILE

| Test-ID | Typ | Zweck | P/O |
|---------|-----|-------|-----|
| T-AUTH-BOOTSTRAP-001 | integration | `bootstrapThenLoadProfile` bei frischer Session | P für M-016 |
| T-AUTH-ADMIN-RPC | integration | `get_own_admin_flags` + `is_current_user_admin` Fehlerpfade | P für M-006,M-007 |
| T-AUTH-PROFILE-001 | integration | Profil lesbar, deactivated flow | P für M-015 |
| T-STATIC-001 | static | typecheck/lint nach Doku-Only-Änderungen | P für M-017 |

### ORG / MULTI-TENANT

| Test-ID | Typ | Zweck | P/O |
|---------|-----|-------|-----|
| T-ORG-001 | integration | `get_my_org_context` mehrere Zeilen wenn Multi-Org-User | P für M-009 |
| T-ORG-002 | manual | Kein Cross-Org-Leak in einer Agency-Ansicht | P für M-003,M-005 |
| T-INT-ORG-001 | integration | Roster / assignments org-scoped | P für M-003 |

### RLS / SQL

| Test-ID | Typ | Zweck | P/O |
|---------|-----|-------|-----|
| T-SQL-001 | sql verification | Gesamter `CURSOR_AUTO_AUDIT_SQL_CHECKS.sql` oder Teilmenge A–E | P für M-001,M-005 |
| T-SQL-002 | sql verification | `pg_get_functiondef` für eine geänderte SECDEF | P für M-003 |
| T-SQL-003 | sql verification | `proconfig` enthält `row_security=off` wo nötig | P für M-003 |
| T-SQL-004 | sql verification | `proname` overload / letzte Definition | P für M-004 |
| T-SQL-005 | sql verification | MAT self_mat + FOR ALL watchlist | P für M-005,M-010 |
| T-SQL-006 | sql verification | Admin-Helper Definitionen konsistent | P für M-006,M-007 |
| T-SQL-007 | sql verification | Storage policies snippet | P für M-011 |
| T-SQL-008 | sql verification | `model_locations` constraints + Near-Me-Funktion | P für M-012 |
| T-RLS-MAT-001 | sql verification | Anti-self-ref count = 0 | P für M-010 |
| T-MANUAL-001 | manual | Review SQL-Ergebnis durch zweite Person | O für M-001 |

### FEATURE FLOWS

| Test-ID | Typ | Zweck | P/O |
|---------|-----|-------|-----|
| T-FEAT-NEARME-001 | e2e / manual | Near Me + Filter | P für M-012 |
| T-FEAT-UPLOAD-001 | e2e | Upload mit Consent | P für M-011 |
| T-FEAT-CHATFILE-001 | e2e | Chat-Datei Upload | P für M-011 |
| T-FEAT-PAYWALL-001 | integration | `has_platform_access` / Paywall | P für M-004 |
| T-INT-CHAT-001 | integration | B2B Chat RPCs | P für M-003 |
| T-GDPR-001 | e2e / staging | Export | P für M-015 |
| T-GDPR-002 | e2e / staging | Deletion request / withdraw | P für M-015 |
| T-E2E-CRITICAL-001 | e2e | Kritische ClientWebApp-Pfade nach .catch-Fix | P für M-013 |

### UNIT / STATIC (Frontend-Vertrag)

| Test-ID | Typ | Zweck | P/O |
|---------|-----|-------|-----|
| T-UNIT-SVC-001 | unit | Betroffene Services nach Signatur-Änderung | P für M-013,M-014 |
| T-LOGIN-ALL | manual batch | Kurzer Durchlauf aller Rollen nach großer RLS-Änderung | P für M-005,M-010 |

---

## Pro Maßnahme — Zuordnung

| Maßnahme | Pflicht-Tests (mindestens) |
|----------|----------------------------|
| M-001 | T-SQL-001, T-MANUAL-001 (O) |
| M-002 | T-STATIC-001 |
| M-003 | T-SQL-002, T-SQL-003, T-INT-ORG-001, T-INT-CHAT-001; nach Fix: betroffene Rolle |
| M-004 | T-SQL-004, T-FEAT-PAYWALL-001 |
| M-005 | T-SQL-001, T-SQL-005, T-LOGIN-ALL |
| M-006 | T-LOGIN-ADMIN, T-AUTH-ADMIN-RPC, T-SQL-006 |
| M-007 | T-LOGIN-ADMIN, T-FEAT-ADMIN-RPC-001, T-SQL-006 |
| M-008 | T-LOGIN-MODEL, T-CLAIM-001, T-INVITE-001 |
| M-009 | T-ORG-001, T-ORG-002 |
| M-010 | T-SQL-005, T-RLS-MAT-001, T-LOGIN-ALL |
| M-011 | T-SQL-007, T-FEAT-UPLOAD-001, T-FEAT-CHATFILE-001 |
| M-012 | T-SQL-008, T-FEAT-NEARME-001 |
| M-013 | T-UNIT-SVC-001, T-E2E-CRITICAL-001 |
| M-014 | T-UNIT-SVC-001, `npm test --ci` |
| M-015 | T-GDPR-001, T-GDPR-002, T-AUTH-PROFILE-001 |
| M-016 | T-LOGIN-ALL, T-AUTH-BOOTSTRAP-001 |
| M-017 | T-STATIC-001 |

---

## LOGIN-All „Batch“-Ablauf (empfohlen nach M-005 / M-010)

1. Admin → Dashboard Liste Users öffnen.  
2. Agency Owner + Booker → Kalender/Messages kurz.  
3. Client Owner + Employee → ein Casting/Discover-Schritt.  
4. Model → Profil speichern.  
5. Guest → Gast-Flow.  
6. Invite neu + Employee-Login.  
7. Model Claim mit Token.

---

*Ende Testmatrix*
