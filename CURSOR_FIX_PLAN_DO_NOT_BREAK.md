# CURSOR_FIX_PLAN_DO_NOT_BREAK.md

**Zweck:** Hochsensible Pfade und Invarianten, die bei Änderungen **Admin-Login**, **Rollen-Logins**, **RLS-Stabilität** oder **Tenant-Isolation** gefährden können.  
**Regel:** Lieber konservativ einstufen als theoretische Härtung ohne Beleg.

---

## 1. `signIn()` ([`src/context/AuthContext.tsx`](src/context/AuthContext.tsx))

| Aspekt | Warum sensibel | Gefährliche Fix-Typen | Nur mit Extra-Tests erlaubt |
|--------|----------------|------------------------|------------------------------|
| Reihenfolge | Step 1 muss Profil/Admin-Flags laden bevor UI routet | Nebeneffekte (Invite, `linkModelByEmail`, Claim) in **dieselbe** try/catch wie `bootstrapThenLoadProfile` | Jede Umstrukturierung nur mit vollständiger LOGIN-Matrix + RPC-Failure-Simulationen |

---

## 2. `bootstrapThenLoadProfile()`

| Aspekt | Warum sensibel | Gefährliche Fix-Typen | Nur mit Extra-Tests erlaubt |
|--------|----------------|------------------------|------------------------------|
| Isolation | Admin und alle Rollen brauchen konsistentes Profil nach Session | Fehler schlucken statt sign-out bei Throw; zusätzliche await-Ketten vor `loadProfile` | Bootstrap-RPC-Änderungen mit Staging + alle Rollen |

---

## 3. `loadProfile()`

| Aspekt | Warum sensibel | Gefährliche Fix-Typen | Nur mit Extra-Tests erlaubt |
|--------|----------------|------------------------|------------------------------|
| Admin-Erkennung | Drei Ebenen (`get_own_admin_flags`, `is_current_user_admin`, `role === 'admin'`) | Entfernen eines Fallbacks; ein einziges RPC ohne Fehlerbehandlung | Nur nach Live-Beweis, dass alle drei redundant sind |

---

## 4. AdminDashboard-Routing ([`App.tsx`](App.tsx))

| Aspekt | Warum sensibel | Gefährliche Fix-Typen | Nur mit Extra-Tests erlaubt |
|--------|----------------|------------------------|------------------------------|
| Reihenfolge | `role === 'admin'` hat kein `effectiveRole` | Admin-Check **nach** `effectiveRole`-Gate oder in Paywall ohne Ausnahme | Jede Routing-Änderung: Admin E2E + Regression `roleFromProfile` |

---

## 5. `get_own_admin_flags` / Fallback-Verhalten

| Aspekt | Warum sensibel | Gefährliche Fix-Typen | Nur mit Extra-Tests erlaubt |
|--------|----------------|------------------------|------------------------------|
| Transiente Fehler | Admin soll nicht von Netzwerk-Flaps ausgesperrt werden | RPC härter machen ohne sekundären Pfad | Änderung an RPC + `loadProfile` nur mit Chaos/Retry-Tests |

---

## 6. `is_current_user_admin` Pinning (UUID + Email)

| Aspekt | Warum sensibel | Gefährliche Fix-Typen | Nur mit Extra-Tests erlaubt |
|--------|----------------|------------------------|------------------------------|
| Identität | Impersonation-Schutz | Lockern der WHERE-Bedingungen in DB | Jede Migration an dieser Funktion: SQL diff + Admin-Login |

---

## 7. `assert_is_admin()`-Kette

| Aspekt | Warum sensibel | Gefährliche Fix-Typen | Nur mit Extra-Tests erlaubt |
|--------|----------------|------------------------|------------------------------|
| Admin-RPCs | Alle schreibenden Admin-Operationen | `assert_is_admin` entfernen oder nach unten schieben | Eine RPC pro PR + Dashboard-Smoke |

---

## 8. Guest / Invite / Claim-Navigation

| Aspekt | Warum sensibel | Gefährliche Fix-Typen | Nur mit Extra-Tests erlaubt |
|--------|----------------|------------------------|------------------------------|
| Step 2 | Darf Step 1 nicht blockieren | Invite/Claim vor Bootstrap | Alle Flows: Invite, Claim, Guest, falscher Invite-Token |

---

## 9. Org-Kontext-Bootstrap

| Aspekt | Warum sensibel | Gefährliche Fix-Typen | Nur mit Extra-Tests erlaubt |
|--------|----------------|------------------------|------------------------------|
| Multi-Tenant | Falsche Org = Datenleck | `LIMIT 1` in `get_my_org_context`; `agencies[0]`; Email-Match | Multi-Membership-Testuser + Service-Filter-Tests |

---

## 10. `profiles` / `models` RLS-Pfad

| Aspekt | Warum sensibel | Gefährliche Fix-Typen | Nur mit Extra-Tests erlaubt |
|--------|----------------|------------------------|------------------------------|
| Login | SELECT auf `profiles` muss ohne 42P17 funktionieren | Neue Policies mit JOIN auf `models`↔`profiles` ohne SECDEF | Jede neue Policy: auto-review Rekursions-Checkliste |

---

## 11. `model_agency_territories` (rekursionssensitiv)

| Aspekt | Warum sensibel | Gefährliche Fix-Typen | Nur mit Extra-Tests erlaubt |
|--------|----------------|------------------------|------------------------------|
| Self-join | Historisch 42P17 für alle Clients | `FROM model_agency_territories` Alias in Policy-QUAL auf gleicher Tabelle | SQL_Check self_mat + LOGIN-ALL nach Migration |

---

## Kurz: globale DO NOT

- **Kein** Fix, der `bootstrapThenLoadProfile` und Nebeneffekte vermischt.  
- **Kein** Fix, der Admin-Routing hinter `effectiveRole` schiebt.  
- **Kein** pauschales `row_security=off` ohne nachgewiesene drei Guard-Ebenen (Regel 21/23).  
- **Keine** Email-Matching-Wiederbelebung als Sicherheits-/Kontextquelle.  
- **Keine** Models in `organization_members`.  
- **Keine** „Vereinheitlichung“ der Admin-Helper ohne Live-Beweis und E2E.

---

*Bezug: [`CURSOR_FIX_PLAN.md`](CURSOR_FIX_PLAN.md), [`CURSOR_AUTO_AUDIT_LOGIN_SAFETY.md`](CURSOR_AUTO_AUDIT_LOGIN_SAFETY.md)*
