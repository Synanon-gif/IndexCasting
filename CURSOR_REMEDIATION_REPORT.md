# CURSOR_REMEDIATION_REPORT.md

**Status:** Plan-Modus — Markdown-Artefakte sind im Repo. Die **physische** Datei `supabase/migrations/20260426_*.sql` und `CURSOR_REMEDIATION_NEXT_STEPS.json` konnten hier nicht angelegt werden (Schreibschutz für Nicht-Markdown). SQL steht vollständig in **Anhang A**; JSON-Inhalt in [CURSOR_REMEDIATION_NEXT_STEPS.md](CURSOR_REMEDIATION_NEXT_STEPS.md) zum Kopieren.

**Abschlusslabel (diese Session):** siehe unten — `PARTIAL REMEDIATION APPLIED`.

---

## Executive Summary

Auf Basis von [CHATGPT_LIVE_DB_STATE.txt](CHATGPT_LIVE_DB_STATE.txt) sind drei Policies mit `profiles` + `role`-Heuristik bestätigt:

| Tabelle | Policy | Problem |
|---------|--------|---------|
| `agency_invitations` | Agents can read own agency invitations | `EXISTS (profiles … role = 'agent')` |
| `agency_invitations` | Agents can update own agency invitations | dasselbe in USING + WITH CHECK |
| `model_photos` | Clients see visible model photos | `EXISTS (profiles … role = 'client')` OR org branches |

**Geplante minimal-invasive Remediation:** Eine Migration `supabase/migrations/20260426_remediation_three_policies_no_profiles_rls.sql` ersetzt diese Checks durch:

- **Agency invitations:** dieselbe Agency-Zugehörigkeitslogik wie bei `public.models` (Agency-`organizations` + `organization_members` mit owner/booker/employee, Agency-Owner, oder Legacy `bookers`) — **kein** `profiles`-Zugriff.
- **Model photos:** `public.caller_is_client_org_member()` (bereits [20260413_fix_d_models_rls_client_secdef.sql](supabase/migrations/20260413_fix_d_models_rls_client_secdef.sql)) statt `profiles.role = 'client'` und redundanter org-ORs.

**Login-/Admin-Sicherheit:** Keine Änderung an `AuthContext.tsx`, `App.tsx`, `signIn`, `bootstrapThenLoadProfile`, `loadProfile`, `get_own_admin_flags`, `is_current_user_admin`, `assert_is_admin`, `get_my_org_context`. Admin nutzt diese drei Policies typischerweise nicht (Admin `role` ≠ agent/client); RLS auf `agency_invitations` / `model_photos` berührt den Profil-Login-Pfad nicht.

---

## Was bewusst NICHT geändert wird

- `Agents can insert own agency invitations` — enthält weiterhin `profiles.role = 'agent'` → **MANUAL_REVIEW_REQUIRED** (vierter Policy-Typ, nicht in den 3 Live-High-Findings des Auftrags).
- Alle 109+ SECDEF ohne `row_security` in `proconfig` — nur Review (Phase 3).
- `recruiting_chat_threads` / `recruiting_chat_messages` — Pentest-Fixes enthalten ggf. noch Email-Zweige; **nur dokumentiert**, kein Auto-Fix.

---

## Legacy Email / Profile in Recruiting Chat (Zusatzcheck)

In [supabase/migration_pentest_fullaudit_fixes_2026_04.sql](supabase/migration_pentest_fullaudit_fixes_2026_04.sql) nutzt `recruiting_threads_update` u. a. `get_current_user_email()` + `agencies.email` — bewusst **nicht** Teil dieser Migration (Risiko Gefahr 2 / nur Review).

[supabase/migrations/20260405_security_three_dangers_fix.sql](supabase/migrations/20260405_security_three_dangers_fix.sql) entfernte Email-Branches aus SELECT/UPDATE — Repo enthält **zwei Evolutionsstände**; Live-DB mit Pentest-Migration kann abweichen.

---

## SECDEF Top-20 (Deep Review — Phase 3, ohne Migration)

Kriterien: aus statischer Heuristik `prosecdef` + `reads_multi_tenant_tables` + fehlendes `row_security=off` in `proconfig` (Audit-JSON). Pro Zeile: typischerweise **aus Policy aufgerufen?** nur nach `pg_depend`/Live-DB klärbar — hier **MANUAL_REVIEW_REQUIRED** wenn unsicher.

| # | Funktion | Liest MT-Tabellen? | Policy-Aufruf? | row_security=off nötig? | Interne Guards | Login/Admin-sensitiv? | Klassifikation |
|---|----------|--------------------|----------------|-------------------------|----------------|------------------------|----------------|
| 1 | `accept_organization_invitation` | ja | unklar | ggf. ja | teils | Invite-Flow | MANUAL_REVIEW_REQUIRED |
| 2 | `add_model_territories` | ja | unklar | prüfen | schwach laut Heuristik | Agency | MANUAL_REVIEW_REQUIRED |
| 3 | `add_model_to_project` | ja | eher RPC | neueste Def. prüfen | resource scope | Client-Projekt | SAFE_CANDIDATE_NEXT |
| 4 | `agency_claim_unowned_model` | ja | RPC | prüfen | prüfen | Model/Agency | MANUAL_REVIEW_REQUIRED |
| 5 | `agency_confirm_client_price` | ja | unklar | prüfen | prüfen | B2B | MANUAL_REVIEW_REQUIRED |
| 6 | `agency_link_model_to_user` | ja | RPC | prüfen | prüfen | deprecated | DO_NOT_TOUCH_YET |
| 7 | `admin_get_org_storage_usage` | ja | Admin | nur nach Review | assert_is_admin | Admin | DO_NOT_TOUCH_YET |
| 8 | `admin_purge_user_data` | ja | Admin | nur nach Review | assert_is_admin | Admin/GDPR | DO_NOT_TOUCH_YET |
| 9 | `admin_set_bypass_paywall` | ja | Admin | nur nach Review | assert_is_admin | Admin | DO_NOT_TOUCH_YET |
| 10 | `admin_set_organization_member_role` | ja | Admin | nur nach Review | assert_is_admin | Admin | DO_NOT_TOUCH_YET |
| 11 | `admin_update_org_details` | ja | Admin | nur nach Review | assert_is_admin | Admin | DO_NOT_TOUCH_YET |
| 12 | `admin_update_profile` | ja | Admin | nur nach Review | assert_is_admin | Admin | DO_NOT_TOUCH_YET |
| 13 | `admin_update_profile_full` | ja | Admin | nur nach Review | assert_is_admin | Admin | DO_NOT_TOUCH_YET |
| 14 | `get_guest_link_models` | kontextabh. | RPC/Anon | eigene Audit-Notiz | link-scope | Guest | MANUAL_REVIEW_REQUIRED |
| 15 | `has_platform_access` | ja | Policies | bewusst speziell | Paywall | alle Rollen | MANUAL_REVIEW_REQUIRED |
| 16 | `is_org_member` | ja | viele Policies | **sollte** off sein (Fix 20260405) | Mitgliedschaft | Org | MANUAL_REVIEW_REQUIRED wenn Live drift |
| 17 | `check_org_access` | ja | Policies | prüfen | org+type | Multi-tenant | MANUAL_REVIEW_REQUIRED |
| 18 | `get_my_org_context` | ja | Client | **nicht ändern** (Auftrag) | — | Login/Org | DO_NOT_TOUCH_YET |
| 19 | `generate_model_claim_token` | ja | RPC | prüfen | Model/Org | Claim | MANUAL_REVIEW_REQUIRED |
| 20 | `claim_model_by_token` | ja | RPC | prüfen | Token | Claim | MANUAL_REVIEW_REQUIRED |

*Hinweis:* Exakte „wird aus Policy aufgerufen“-Spalte erfordert Live-DB (`pg_policies` + `pg_get_expr` / Abhängigkeitsgraph) — nicht aus dem Repo allein beweisbar.

---

## Phase 2 — Tests + SQL-Verifikation (Checkliste)

- SQL: alle Abschnitte in [CURSOR_REMEDIATION_SQL_VERIFY.md](CURSOR_REMEDIATION_SQL_VERIFY.md).
- Login (manuell, nach Deploy): Admin; Agency Owner; Agency Booker; Client Owner; Client Employee; Model — unveränderte Flows, kein erwarteter Einfluss auf `profiles`-SELECT für Login.
- Feature: `agency_invitations` lesen/updaten (Agency); Client mit aktivem Zugang sichtbare `model_photos` (`is_visible_to_clients`).

Keine großen neuen Jest-Suites nötig; reine RLS-Änderung ohne `src/`-Diff.

---

## Nächste sichere Schritte (Phase 4)

1. Migration deployen (Supabase API/CLI laut Projektregeln).
2. SQL-Verification aus [CURSOR_REMEDIATION_SQL_VERIFY.md](CURSOR_REMEDIATION_SQL_VERIFY.md) ausführen.
3. Manuelle Login-Matrix (Admin, Agency Owner/Booker, Client Owner/Employee, Model).
4. Optional: zweite Migration nur für `Agents can insert own agency invitations` nach gleichem Agency-Side-Muster.
5. Recruiting-Chat-Email-Branches gesondert designen (SECDEF/Org-only).

---

## Migration — Dateiname und Inhalt

**Datei:** `supabase/migrations/20260426_remediation_three_policies_no_profiles_rls.sql`

Vollständiger SQL-Text: im Agent-Modus aus dem Chat-Output des Assistenten übernehmen oder unten aus **Anhang A** (wenn in separater Nachricht geliefert).

---

## Anhang A — Vollständige Migration SQL

Speichern als `supabase/migrations/20260426_remediation_three_policies_no_profiles_rls.sql`:

```sql
-- =============================================================================
-- Remediation (2026-04-26): Remove profiles.role from 3 live-confirmed RLS policies
-- =============================================================================

DROP POLICY IF EXISTS "Agents can read own agency invitations" ON public.agency_invitations;

CREATE POLICY "Agents can read own agency invitations"
  ON public.agency_invitations FOR SELECT TO authenticated
  USING (
    (
      EXISTS (
        SELECT 1
        FROM public.organizations o
        JOIN public.organization_members om ON om.organization_id = o.id
        WHERE o.type = 'agency'::organization_type
          AND om.user_id = auth.uid()
          AND om.role = ANY (
            ARRAY[
              'owner'::org_member_role,
              'booker'::org_member_role,
              'employee'::org_member_role
            ]
          )
      )
      OR EXISTS (
        SELECT 1
        FROM public.organizations o
        WHERE o.type = 'agency'::organization_type
          AND o.owner_id = auth.uid()
      )
      OR EXISTS (
        SELECT 1
        FROM public.bookers b
        WHERE b.user_id = auth.uid()
      )
    )
    AND (
      (
        agency_id IS NOT NULL
        AND (
          EXISTS (
            SELECT 1
            FROM public.agencies ag
            JOIN public.organizations o ON o.agency_id = ag.id
            JOIN public.organization_members om ON om.organization_id = o.id
            WHERE ag.id = agency_invitations.agency_id
              AND om.user_id = auth.uid()
          )
          OR EXISTS (
            SELECT 1
            FROM public.agencies ag
            JOIN public.organizations o ON o.agency_id = ag.id
            WHERE ag.id = agency_invitations.agency_id
              AND o.owner_id = auth.uid()
          )
        )
      )
      OR agency_id IS NULL
    )
  );

COMMENT ON POLICY "Agents can read own agency invitations" ON public.agency_invitations IS
  'Agency-side callers via org membership / agency org owner / bookers — no profiles.role. 20260426 remediation.';

DROP POLICY IF EXISTS "Agents can update own agency invitations" ON public.agency_invitations;

CREATE POLICY "Agents can update own agency invitations"
  ON public.agency_invitations
  FOR UPDATE
  TO authenticated
  USING (
    (
      EXISTS (
        SELECT 1
        FROM public.organizations o
        JOIN public.organization_members om ON om.organization_id = o.id
        WHERE o.type = 'agency'::organization_type
          AND om.user_id = auth.uid()
          AND om.role = ANY (
            ARRAY[
              'owner'::org_member_role,
              'booker'::org_member_role,
              'employee'::org_member_role
            ]
          )
      )
      OR EXISTS (
        SELECT 1
        FROM public.organizations o
        WHERE o.type = 'agency'::organization_type
          AND o.owner_id = auth.uid()
      )
      OR EXISTS (
        SELECT 1
        FROM public.bookers b
        WHERE b.user_id = auth.uid()
      )
    )
    AND agency_id IS NOT NULL
    AND (
      EXISTS (
        SELECT 1
        FROM public.agencies ag
        JOIN public.organizations o ON o.agency_id = ag.id
        JOIN public.organization_members om ON om.organization_id = o.id
        WHERE ag.id = agency_invitations.agency_id
          AND om.user_id = auth.uid()
      )
      OR EXISTS (
        SELECT 1
        FROM public.agencies ag
        JOIN public.organizations o ON o.agency_id = ag.id
        WHERE ag.id = agency_invitations.agency_id
          AND o.owner_id = auth.uid()
      )
    )
  )
  WITH CHECK (
    (
      EXISTS (
        SELECT 1
        FROM public.organizations o
        JOIN public.organization_members om ON om.organization_id = o.id
        WHERE o.type = 'agency'::organization_type
          AND om.user_id = auth.uid()
          AND om.role = ANY (
            ARRAY[
              'owner'::org_member_role,
              'booker'::org_member_role,
              'employee'::org_member_role
            ]
          )
      )
      OR EXISTS (
        SELECT 1
        FROM public.organizations o
        WHERE o.type = 'agency'::organization_type
          AND o.owner_id = auth.uid()
      )
      OR EXISTS (
        SELECT 1
        FROM public.bookers b
        WHERE b.user_id = auth.uid()
      )
    )
    AND agency_id IS NOT NULL
    AND (
      EXISTS (
        SELECT 1
        FROM public.agencies ag
        JOIN public.organizations o ON o.agency_id = ag.id
        JOIN public.organization_members om ON om.organization_id = o.id
        WHERE ag.id = agency_invitations.agency_id
          AND om.user_id = auth.uid()
      )
      OR EXISTS (
        SELECT 1
        FROM public.agencies ag
        JOIN public.organizations o ON o.agency_id = ag.id
        WHERE ag.id = agency_invitations.agency_id
          AND o.owner_id = auth.uid()
      )
    )
  );

COMMENT ON POLICY "Agents can update own agency invitations" ON public.agency_invitations IS
  'UPDATE WITH CHECK mirrors USING; agency-side caller without profiles.role. 20260426 remediation.';

DROP POLICY IF EXISTS "Clients see visible model photos" ON public.model_photos;

CREATE POLICY "Clients see visible model photos"
  ON public.model_photos FOR SELECT TO authenticated
  USING (
    is_visible_to_clients = true
    AND public.has_platform_access()
    AND public.caller_is_client_org_member()
  );

COMMENT ON POLICY "Clients see visible model photos" ON public.model_photos IS
  'Paywall + caller_is_client_org_member() — no profiles.role. 20260426 remediation.';
```
