# Security Audit D — Access / Authorization / Data Exposure

**Date:** 2026-04-08  
**Scope:** P1–P9 (RLS, cross-org, storage, invite/claim, services, messaging, booking/calendar/options, admin, JSON exposure)  
**Method:** Repository review (`supabase/migrations/`, `src/services/`, `docs/`) **plus** Live-Database verification via Supabase Management API (`database/query`) on project `ispkfdqzjrfrilosoklu`.  
**Constraint:** No code fixes; findings only where traceable to policy, function body, or documented product rules.

---

## Executive Summary

This audit did **not** identify any **CRITICAL** or **HIGH** confirmed vulnerability in the areas verified. The **primary enforcement** for multi-tenant data is **PostgreSQL RLS** and **SECURITY DEFINER** helpers (`option_request_visible_to_me`, `conversation_accessible_to_me`, `can_view_model_photo_storage`, `caller_is_client_org_member`, paywall helpers), with **Live** confirmation of `row_security=off` where required for policy-invoked helpers.

**Notable outcomes:**

- **SAFE:** `option_requests` visibility is centralized in `option_request_visible_to_me` (Live definition reviewed).  
- **SAFE:** Storage path access for `documentspictures` is gated via `can_view_model_photo_storage` (Live: `row_security=off`).  
- **SAFE:** `models` “open” policy with `USING (true)` applies **only** to **`service_role`**, not `authenticated`.  
- **SAFE:** No `FOR ALL` policies on the RLS watchlist tables (`model_embeddings`, `model_locations`, `model_agency_territories`, `calendar_entries`, `model_minor_consent`) on Live.  
- **SAFE:** No `profiles.is_admin = true` in policy `qual` (Live scan = 0 rows).  
- **INFO:** `booking_details` / `booking_brief` — **full JSONB** is returned on row `SELECT`; per-field “scopes” are **UI-enforced** per product doc (not server-stripped).  
- **LOW:** Some services omit explicit `organization_id` filters and rely on RLS (defense-in-depth gap **only at the app layer**; DB rules verified).  
- **LOW:** Historical SQL for `option_requests` / messenger exists in **root** `supabase/migration_*.sql` as well as `migrations/` — **Live** is source of truth; drift risk for future edits if migrations are incomplete.

**Not exhaustively proven in this pass:** every Edge Function, every `admin_*` RPC for `assert_is_admin()`, and Realtime E2E abuse tests.

---

## Scope & Methodik

| Area | What was checked |
|------|------------------|
| **P1** | Policies on `models`, `model_photos`, `option_requests`, `calendar_entries`, `organization_members`, `recruiting_*`, `conversations`, `messages`; `storage.objects`; SECURITY DEFINER `proconfig` |
| **P2** | `option_request_visible_to_me` (full Live def); service patterns in `optionRequestsSupabase.ts` |
| **P3** | `can_view_model_photo_storage`, `documentspictures_*` policies |
| **P4** | `claim_model_by_token` in `20260413_fix_c_model_claim_tokens.sql` (single-use, atomic) |
| **P5** | `modelsSupabase.ts`, `calendarSupabase.ts`, `optionRequestsSupabase.ts`, `messengerSupabase.ts`, `guestChatSupabase.ts` |
| **P6** | `conversation_accessible_to_me` Live; `subscribeToConversation` Realtime filter |
| **P7** | `calendar_entries` canonical migration `20260502_calendar_entries_rls_canonical_client_update.sql` + Live policy names |
| **P8** | Policy scan for unsafe `is_admin` usage; admin rules per `.cursor/rules/admin-security.mdc` (reference) |
| **P9** | `docs/BOOKING_BRIEF_SYSTEM.md` trust model |

---

## Simulation Matrix (7 Modi)

| Mode | Primary enforcement (verified / expected) |
|------|-------------------------------------------|
| **1. Client, wrong org** | `option_request_visible_to_me` requires membership in option’s client orgs or legacy `client_id`; `caller_is_client_org_member` for client-visible photos |
| **2. Agency, wrong agency** | Agency branches in `option_request_visible_to_me` tie to `agency_organization_id` or org bridge to `agency_id` + assignee rules |
| **3. Model → other models** | `model_self_read` only `user_id = auth.uid()`; discovery uses `clients_read_visible_models` + visibility flags (repo) |
| **4. Invited, not finalized** | Invite/claim RPCs require `authenticated`; unfinished invite flows do not grant org rows until RPC succeeds (not E2E-tested here) |
| **5. Guest / external link** | Guest flows use scoped RPCs (`get_guest_link_models`, etc.) per architecture; **anon** `model_photos` SELECT exists for portfolio visibility — product surface |
| **6. Manipulated query params** | ID-only service calls (`getConversationById`, `getMessages`) **must** fail without RLS — Live policies use `conversation_accessible_to_me` / org-member policies |
| **7. Old tokens / replay** | `claim_model_by_token`: second use → `token_already_used` (migration + logic) |

---

## Findings (klassifiziert)

### SAFE

| ID | Title | Root cause / evidence |
|----|--------|------------------------|
| **D-P1-001** | `models` service_role policy | Live: `Service role full access models` → `roles={service_role}`, `qual=true` — intentional for backend only. |
| **D-P1-002** | No dangerous `FOR ALL` on watchlist tables | Live query returned no rows for `cmd=ALL` on listed tables. |
| **D-P1-003** | No `profiles.is_admin = true` in RLS quals | Live count = 0. |
| **D-P2-001** | Option request isolation | Live `option_request_visible_to_me` covers model, client (org + legacy), agency (org + legacy + assignee). |
| **D-P3-001** | Photo storage helper | Live `can_view_model_photo_storage`: `proconfig` includes `row_security=off`; migration documents client binding to `model_photos` path. |
| **D-P3-002** | Storage policies present | Live: `documentspictures_select_scoped` and related policies on `storage.objects`. |
| **D-P4-001** | Claim token single-use | `20260413_fix_c_model_claim_tokens.sql`: atomic `UPDATE ... WHERE used_at IS NULL` + `token_already_used`. |
| **D-P6-001** | Conversation helper | Live: `conversation_accessible_to_me` has `row_security=off`. |

### LOW

| ID | Title | Root cause | Minimal mitigation (conceptual) |
|----|--------|------------|-----------------------------------|
| **D-P5-001** | Optional `orgId` in `getOptionRequests` | Service warns; relies on RLS. | Always pass `organization_id` from `profile` for defense-in-depth (already project direction). |
| **D-DRIFT-001** | Root SQL vs `migrations/` | Option/messenger history spans files outside `migrations/`. | Prefer new DDL only via dated migrations + Live `pg_policies` / `pg_get_functiondef` after deploy. |

### INFO

| ID | Title | Exploit scenario | Note |
|----|--------|------------------|------|
| **D-P9-001** | `booking_details` JSON | Caller with legitimate `calendar_entries` SELECT could read full JSON including fields hidden in UI for their role. | Documented in [`docs/BOOKING_BRIEF_SYSTEM.md`](docs/BOOKING_BRIEF_SYSTEM.md); not treated as “UI-only bug” but as **stated trust boundary**. |
| **D-P6-002** | Duplicate `conversations` SELECT policies | None identified from qual snippets alone; policies OR together. | Consolidation optional (maintainability). |

---

## Root-SQL vs Live (Drift)

Per [`system-invariants.mdc`](.cursor/rules/system-invariants.mdc), **Live** is authoritative. This audit reconciled critical helpers on Live (`conversation_accessible_to_me`, `can_view_model_photo_storage`, `caller_is_client_org_member`, `has_platform_access`, `option_request_visible_to_me`). Remaining drift risk is **processual** (D-DRIFT-001), not a confirmed exploit.

---

## Offene Punkte (weitere Verifikation)

1. **Edge Functions** — JWT validation, org pins, rate limits: not part of SQL pass.  
2. **Alle `admin_*` RPCs** — vollständige Prüfung auf `assert_is_admin()` als erste Zeile.  
3. **Realtime** — manuelle/E2E-Tests: Subscription mit fremder `conversation_id` (Client-seite filtert Kanal; Server muss RLS für `messages` beibehalten).  
4. **Gast-Link-Token** — Ablauf/Widerruf über DB/RPC (nicht vollständig per API durchgespielt).

---

## Referenzen (Repo)

- Kanonisch `calendar_entries`: [`supabase/migrations/20260502_calendar_entries_rls_canonical_client_update.sql`](supabase/migrations/20260502_calendar_entries_rls_canonical_client_update.sql)  
- Client model photos / storage: [`supabase/migrations/20260501_can_view_model_photo_storage_client_row_alignment.sql`](supabase/migrations/20260501_can_view_model_photo_storage_client_row_alignment.sql), [`docs/CLIENT_MODEL_PHOTO_VISIBILITY.md`](docs/CLIENT_MODEL_PHOTO_VISIBILITY.md)  
- Booking Brief Trust: [`docs/BOOKING_BRIEF_SYSTEM.md`](docs/BOOKING_BRIEF_SYSTEM.md)  
- Claim token: [`supabase/migrations/20260413_fix_c_model_claim_tokens.sql`](supabase/migrations/20260413_fix_c_model_claim_tokens.sql)

---

## Zusammenfassung Counts

| Severity | Count |
|----------|-------|
| CRITICAL | 0 |
| HIGH | 0 |
| MEDIUM | 0 |
| LOW | 2 |
| INFO | 2 |
| SAFE | 8 |

Maschinenlesbar: [`CURSOR_SECURITY_AUDIT_D_PLAN.json`](CURSOR_SECURITY_AUDIT_D_PLAN.json).
