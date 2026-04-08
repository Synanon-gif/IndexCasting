# DSGVO / Privacy / Data Lifecycle — Analyse (nur Evidence)

## 1. Executive Summary (max. 10 Sätze)

- Es gibt einen **serverseitigen Account-Löschpfad** über die Edge Function [`supabase/functions/delete-user/index.ts`](supabase/functions/delete-user/index.ts): `auth.admin.deleteUser` plus explizites Löschen von Storage-Objekten unter definierten Präfixen; Kommentar dokumentiert **CASCADE von `profiles`** sowie **`models.user_id` → SET NULL** (Modelldatensatz bleibt).
- **Organisations-Löschung** ist als RPC `delete_organization_data` in [`supabase/migration_gdpr_compliance_2026_04.sql`](supabase/migration_gdpr_compliance_2026_04.sql) beschrieben und löscht u. a. `model_photos`-Zeilen, `models`, `calendar_entries`, `guest_links`, Konversationen/Nachrichten und org-bezogene Daten — **ohne** in dieser Migration sichtbare Storage-API für `documentspictures`.
- **Datenexport (Art. 20)** existiert als `export_user_data` in [`supabase/migrations/20260420_gdpr_rpc_row_security_account_delete_membership.sql`](supabase/migrations/20260420_gdpr_rpc_row_security_account_delete_membership.sql) und wird vom Client über [`src/services/gdprComplianceSupabase.ts`](src/services/gdprComplianceSupabase.ts) angesprochen; der Umfang ist **explizit auf ausgewählte Tabellen/Limits** begrenzt (z. B. `messages` max. 1000, `option_requests` nur `created_by`, **keine** `legal_acceptances` im JSON).
- **Einwilligung / Widerruf:** [`src/context/AuthContext.tsx`](src/context/AuthContext.tsx) schreibt `legal_acceptances` und synchronisiert `consent_log` via `recordConsent`; Widerruf läuft über `withdraw_consent` (gleiche Migrationsdatei) und UI in [`src/components/AgencySettingsTab.tsx`](src/components/AgencySettingsTab.tsx) / [`src/web/ClientWebApp.tsx`](src/web/ClientWebApp.tsx).
- **Gast-Links:** Gültigkeit und 7-Tage-Fenster sind in [`supabase/migrations/20260406_guest_link_first_access_7day_window.sql`](supabase/migrations/20260406_guest_link_first_access_7day_window.sql) in `get_guest_link_info` codiert; Widerruf über `revoke_guest_access` in [`supabase/migration_compliance_hardening_2026_04.sql`](supabase/migration_compliance_hardening_2026_04.sql).
- **Retention / Lösch-Fristen:** `gdpr_purge_expired_deletions`, `gdpr_purge_old_audit_trail`, `gdpr_purge_old_security_events`, `gdpr_purge_old_guest_link_access_log` sind in Migrationen definiert; `gdpr_purge_expired_deletions` **anonymisiert** Profile und entfernt Mitgliedschaften, die Kommentare verlangen für vollständige Auth-Löschung zusätzlich **`auth.admin.deleteUser`** — im Ordner [`supabase/functions/`](supabase/functions/) ist **kein** dedizierter Cron/Purge-Job als Function abgelegt (nur u. a. `delete-user`).
- **Shared Selection:** URL-Parameter werden in [`src/views/SharedSelectionView.tsx`](src/views/SharedSelectionView.tsx) genannt; [`index.html`](index.html) enthält **kein** `noindex`-Meta — Aussage zur Indexierbarkeit der SPA ist ohne weitere Build-/Routing-Evidenz nur eingeschränkt belegbar.
- **Tracking:** Zentrale Audit-/Security-Pfade (`audit_trail`, `security_events`, `logAction`-Dokumentation in [`src/utils/logAction.ts`](src/utils/logAction.ts)); keine PostHog/Segment-Integration in den durchsuchten `src`-Treffern.

---

## 2. Data Lifecycle pro Entity (create / read / update / delete) — knapp, evidence-basiert

| Entity | Create | Read | Update | Delete |
|--------|--------|------|--------|--------|
| **profiles / auth.users** | Signup/Auth (implizit) | `export_user_data` subset | `acceptTerms` u. a. in AuthContext | `delete-user` Edge Function → `auth.admin.deleteUser`; Soft-Delete-Felder + `request_personal_account_deletion` / `gdpr_purge_expired_deletions` (Anonymisierung) |
| **organization_members** | Invite/Membership-Flows | Export: `organizations` join | — | `request_personal_account_deletion` DELETE; `delete_organization_data` DELETE; CASCADE laut delete-user-Kommentar |
| **models** | Agency/Flows | Discovery/RPCs | — | `delete_organization_data` DELETE bei Agency; **Einzelnutzer-Löschung:** `models.user_id` SET NULL laut delete-user-Kommentar |
| **messages** | Chat-Insert | Export: gesendete Messages (Limit 1000) | — | `delete_organization_data` löscht Messages über Conversation-Filter |
| **option_requests** | Client/Flows | Export: nur Zeilen mit `created_by = p_user_id`, Limit 500 | — | Client-Teil in `delete_organization_data` |
| **calendar_entries** | Booking-Flows | **Nicht** als `calendar_entries` in `export_user_data` (Export nutzt `user_calendar_events`) | — | `delete_organization_data` DELETE `calendar_entries` für Agency |
| **model_photos** | Upload-Services | RLS/Storage | — | Zeilen-DELETE in `delete_organization_data`; **Storage** für Portfolio: delete-user **explizit nicht** für `model-photos`-Pfad |
| **storage.objects** | Upload-Pipelines | Signed URLs / Policies | — | delete-user: nur dokumentierte Präfixe (`documents`, `documentspictures`/`verifications`); Kommentar schließt `model-photos` und beschreibt `chat-files` über Message-Cascade |
| **activity_logs** | App/DB | — | — | CASCADE von `profiles` laut Kommentar in `delete-user/index.ts`; **nicht** in `export_user_data` (kein `activity_logs`-SELECT in `20260420_*.sql`) |
| **recruiting_chat_*** | Agency-Flows | — | — | `delete_organization_data` DELETE `recruiting_chat_messages` / `recruiting_chat_threads` für Agency (`migration_gdpr_compliance_2026_04.sql`); **nicht** in `export_user_data` |

---

## 3. Tabelle

| Area | Status | Risk | Notes |
|------|--------|------|-------|
| User data deletion | Teilweise implementiert | MEDIUM–HIGH | Vollständiger Auth-Delete nur über `delete-user`; 30-Tage-Purge anonymisiert in DB, **Auth-Delete-Automatisierung** nicht als eigene Function im Repo |
| Storage cleanup | Teilweise | MEDIUM | Explizite Buckets/Präfixe in delete-user; Org-Löschung ohne sichtbare Storage-Löschung für alle Model-Fotos in gezeigter SQL |
| Data access (Art. 15/20) | Vorhanden, lückenhaft | MEDIUM | `export_user_data` ohne `legal_acceptances`, ohne `calendar_entries` als solche; ohne `activity_logs`, ohne Recruiting-Chat; Limits auf Messages/Optionen |
| Consent / legal basis | Gemischt | LOW–MEDIUM | `legal_acceptances` + `consent_log` Sync in AuthContext; Rechtsgrundlagen-Text in SQL-Kommentaren/Retention-Tabelle (`migration_compliance_hardening`) |
| Revocation | Teilweise | LOW | `withdraw_consent`; `revoke_guest_access`; Invite-Org-Löschung löscht `invitations` |
| Tracking / logging | Umfangreich | LOW–MEDIUM | Audit/Security-Events; Gast-Rate-Limit mit IP-Hash in Migrationen beschrieben |
| Guest / public | Implementiert | LOW | Ablauf + Revoke in RPCs; `index.html` ohne noindex |
| Messaging / booking | Gespeichert | MEDIUM | Export-Teilmenge; Retention-Funktionen für Audit/Security/Gast-Log |
| Data minimization | Konzepte | INFO | Legacy `bust`/`chest` in Regeln; DB-Felder teils redundant |

---

## 4. Findings (nur belegbar)

### CRITICAL

- **Auth-Löschung nach 30-Tage-Purge:** [`gdpr_purge_expired_deletions`](supabase/migration_gdpr_compliance_2026_04.sql) anonymisiert nur und verlangt laut Kommentar extern `auth.admin.deleteUser` — **kein** zweites Edge-Function-File im Repo, das dies automatisiert.

### MEDIUM

- **Export unvollständig:** `export_user_data` enthält **`consent_log`**, aber **keine** `legal_acceptances` ([`20260420_gdpr_rpc_row_security_account_delete_membership.sql`](supabase/migrations/20260420_gdpr_rpc_row_security_account_delete_membership.sql)), obwohl `acceptTerms` beide schreibt ([`AuthContext.tsx`](src/context/AuthContext.tsx)).
- **Kalender:** Export nutzt `user_calendar_events`, nicht **`calendar_entries`** — Buchungskalender-Daten des Nutzers erscheinen so **nicht** im Export-JSON.
- **Org-Löschung vs. Storage:** `delete_organization_data` löscht `model_photos`-**Zeilen**, nicht nachgewiesen dass alle **Storage-Objekte** in `documentspictures` entfernt werden (kein `storage.remove` in dieser SQL-Funktion).
- **Weitere Tabellen ohne Export:** `activity_logs` (wird bei Profil-Löschung laut `delete-user`-Kommentar mit CASCADE entfernt) und **Recruiting-Chat** (`recruiting_chat_*`) erscheinen **nicht** im `export_user_data`-JSON (`20260420_*.sql` enthält keine entsprechenden SELECTs; Org-Löschung löscht Recruiting-Chat in `migration_gdpr_compliance_2026_04.sql`).

### LOW

- **Marketing/Analytics-Widerruf:** UI und `withdrawConsent` existieren; ob Backend alle optionalen Verarbeitungen stoppt, ist aus den gelesenen Dateien **nicht** vollständig ableitbar (kein weiterer Code-Pfad geprüft).

### INFO

- **Gast-Link:** 7-Tage-Zugriff nach erstem Zugriff und `expires_at` in `get_guest_link_info` ([`20260406_guest_link_first_access_7day_window.sql`](supabase/migrations/20260406_guest_link_first_access_7day_window.sql)).
- **Dokumentierte Retention** (z. B. `guest_links`, `guest_link_access_log`) in [`migration_compliance_hardening_2026_04.sql`](supabase/migration_compliance_hardening_2026_04.sql).

---

## 5. Was im geprüften Scope fehlt oder unklar bleibt

- Vollständiger **Nachweis** automatisierter **Auth-User-Purge** nach 30 Tagen (nur Kommentar + SQL, keine Cron-Function im Repo).
- **Art. 15** als „alles anzeigen“: Export deckt nur definierte Tabellen/Limits ab.
- **Retention** für alle Message-/Chat-Daten über die gezeigten Purge-Funktionen hinaus nicht vollständig kartiert (weitere Tabellen würden zusätzliche Suche erfordern).

---

## 6. Was bereits gut gelöst ist (Evidence)

- **Self-Service + Admin** für `delete-user` mit JWT- und Admin-Flag-Prüfung ([`delete-user/index.ts`](supabase/functions/delete-user/index.ts)).
- **Explizite Storage-Bereinigung** für dokumentierte User-Pfade vor Auth-Delete (gleiche Datei).
- **Datenexport-RPC** mit Audit-Log `data_exported` ([`20260420_...sql`](supabase/migrations/20260420_gdpr_rpc_row_security_account_delete_membership.sql)).
- **`consent_log`-Sync bei `acceptTerms`** ([`AuthContext.tsx`](src/context/AuthContext.tsx) Zeilen 746–756).
- **Gast-Link:** Rate-Limit, IP-Hash-Kommentare, Revoke-RPC ([`revoke_guest_access`](supabase/migration_compliance_hardening_2026_04.sql)).

---

## Quellen (Kern-Dateien)

- [`supabase/functions/delete-user/index.ts`](supabase/functions/delete-user/index.ts)
- [`supabase/migration_gdpr_compliance_2026_04.sql`](supabase/migration_gdpr_compliance_2026_04.sql)
- [`supabase/migrations/20260420_gdpr_rpc_row_security_account_delete_membership.sql`](supabase/migrations/20260420_gdpr_rpc_row_security_account_delete_membership.sql)
- [`supabase/migrations/20260406_guest_link_first_access_7day_window.sql`](supabase/migrations/20260406_guest_link_first_access_7day_window.sql)
- [`supabase/migration_compliance_hardening_2026_04.sql`](supabase/migration_compliance_hardening_2026_04.sql)
- [`src/context/AuthContext.tsx`](src/context/AuthContext.tsx)
- [`src/services/gdprComplianceSupabase.ts`](src/services/gdprComplianceSupabase.ts)
- [`src/services/guestAuthSupabase.ts`](src/services/guestAuthSupabase.ts)

---

**FINAL LINE:** PRIVACY AUDIT COMPLETE — FINDINGS IDENTIFIED
