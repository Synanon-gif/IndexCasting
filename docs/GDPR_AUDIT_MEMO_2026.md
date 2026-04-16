# GDPR/DSGVO technical audit — export & erasure (2026)

**Nature:** Engineering compliance review (not legal advice). **Verdict:** **partially_compliant** — core Art. 15 export and Art. 32 export auth are sound; v4 closes identified Art. 5 third-party leaks in invitations/options/push tokens; Art. 17 remains **partial** by design where B2B retention applies.

---

## Phase 1 — Personal data scope & subjects

**Personal data in product:** identifiers (`profiles.email`, `display_name`, `models.email`, …), auth/user linkage (`user_id`, `participant_ids`), communication (`messages`, `option_request_messages`, recruiting chats), behavioural/workflow (`option_requests`, `activity_logs`, `notifications`, calendars), inferred roles (`profiles.role`, org membership roles).

**Article 15:** Applies to **all natural-person users** (model, booker, employee, owner, guest with account, admin as data subject for their own export). **Organization ownership does not remove** the member’s right of access to **their** data.

**UI / RPC access:** `export_user_data` allows `auth.uid() = p_user_id` **or** `is_current_user_admin()` **or** `is_current_user_super_admin()`. Export UI exists on **Model** (`ModelProfileScreen`), **Agency** (`AgencySettingsTab`), **Client web** (`ClientWebApp` privacy section). **Gap (LOW):** no dedicated grep hit for a separate **Client native** screen — confirm parity if a native client app exists outside these files.

---

## Phase 2 — Article 15: `export_user_data` coverage

### Implemented domains (v4 RPC)

| JSON key | Source table(s) | Notes |
|----------|------------------|--------|
| `profile` | `profiles` | Own row |
| `consent_log` | `consent_log` | |
| `legal_acceptances` | `legal_acceptances` | |
| `organizations` | `organization_members` + `organizations` | Multi-org: one row per membership |
| `messages_sent` / `messages_received` | `messages` | Limits 1000 each; `sender_ref` pseudonym |
| `conversations` | `conversations` | `participant_id_refs`, limits |
| `recruiting_chat_threads` / `recruiting_chat_messages` | recruiting tables | |
| `option_requests` | `option_requests` | v4: user UUIDs as `*_ref` |
| `option_request_messages` | `option_request_messages` | Visibility helper + model `visible_to_model`; v4: `booker_ref` |
| `option_documents` | `option_documents` | v4: `uploaded_by_ref` |
| `model_profile` | `models` | Full `to_jsonb(m)` for linked model |
| `model_photos` | `model_photos` | |
| `client_projects` | `client_projects` | v4: `owner_ref` |
| `invitations` | `invitations` | v4: subject email OR `invited_by` only |
| `booking_events` | `booking_events` | |
| `calendar_events` | `user_calendar_events` | |
| `calendar_entries` | `calendar_entries` | |
| `notifications` | `notifications` | |
| `activity_logs` | `activity_logs` | |
| `audit_trail` | `audit_trail` | `user_id` OR `entity_id = subject` |
| `image_rights_confirmations` | `image_rights_confirmations` | |
| `push_tokens` | `push_tokens` | v4: `has_token` only, no raw token |

### Completeness gaps (residual — MEDIUM/LOW)

| Area | Risk | Notes |
|------|------|--------|
| `model_applications` | MEDIUM | Applicant may be covered indirectly via `recruiting_chat_threads` + messages; **full application row** not a dedicated export key — evaluate DPO if form fields hold PII beyond chat. |
| `security_events` | LOW–MEDIUM | `user_id`-scoped security telemetry not in export list — may still be personal data; consider inclusion or documented exclusion (retention doc). |
| `user_thread_preferences` | LOW | Not in export; may hold subject prefs. |
| Guest-only tables | context | Guest flows may need separate audit if `guest_user_id` linkage is incomplete. |
| Limits (1000/5000…) | LOW | Very large accounts truncate — document in privacy policy / offer layered export if required. |

**Empty / JSON stability:** `COALESCE(jsonb_agg(...), '[]'::jsonb)` used; frontend `formatExportPayload` normalizes missing keys to `[]`.

---

## Phase 3 — Article 5 minimization (v4 fixes)

| Issue (pre-v4) | Severity | v4 mitigation |
|------------------|----------|----------------|
| `invitations` exported **all** invites for any org the user belonged to → **other invitees’ emails** | **CRITICAL** | WHERE restricted to `lower(email)=subject` OR `invited_by = subject`. |
| `option_requests` exposed raw `client_id`, `booker_id`, `created_by`, `agency_assignee_user_id` | **HIGH** | Replaced with `client_user_ref`, `booker_user_ref`, `created_by_ref`, `agency_assignee_ref` via `gdpr_export_actor_ref`. |
| `option_request_messages.booker_id` raw UUID | **HIGH** | `booker_ref`. |
| `option_documents.uploaded_by` UUID-as-text | **MEDIUM** | `uploaded_by_ref` when UUID-shaped; else passthrough (legacy). |
| `client_projects.owner_id` for non-owner org members | **HIGH** | `owner_ref`. |
| `push_tokens.token` in export | **HIGH** (Art. 32) | `has_token` boolean only. |

**Residual MEDIUM:** `messages.metadata`, `notifications.metadata`, `audit_trail.entity_id` (may reference other entities’ UUIDs) — spot-check recommended; no change in v4.

**Commercial fields on `option_requests`:** Still exported for scoped rows (product truth). Model-facing **UI** hides prices; **DPO** decides if model Art. 15 should redact prices in export (policy, not implemented here).

---

## Phase 4 — Article 17: erasure & anonymization

| Path | Behaviour | Gap |
|------|-----------|-----|
| `request_account_deletion` / `request_personal_account_deletion` | Soft-delete flag on profile | Documented 30-day process. |
| `anonymize_user_data` | Profile PII scrub, `calendar_feed_token_hash` NULL, **DELETE** `organization_members`, recruiting message text scrub, **v4:** `models.email = NULL` where `user_id = p_user_id` | B2B `messages` / `option_requests` content **not** wiped (retention / legal hold — matches RPC comment). |
| `delete-user` Edge | `auth.admin.deleteUser`, storage prefixes `documents/{userId}`, `verifications/{userId}`, `cleanup_conversation_participants` | `models.user_id` **SET NULL** on auth delete per Edge comment — **agency-owned model row persists**; v4 anonymize clears model email when anonymize RPC runs. **Agency portfolio storage** intentionally not deleted in Edge — contractual/agency ownership. |

**Multi-org:** Anonymize removes **all** memberships for that user in one call — expected for “leave platform” anonymization.

---

## Phase 5 — Article 32: security

| Control | Status |
|---------|--------|
| `export_user_data` caller gate | **OK** — self or admin/super_admin; unauthenticated → exception. |
| `SECURITY DEFINER` + `row_security off` | **OK** with explicit guards at top of RPC. |
| Calendar feed | Token stored as **SHA-256**; `get_calendar_feed_payload` **service_role** only; wrong token → empty events (no oracle). |
| Export audit | `log_audit_action` with `requested_by` + `exported_user`. |

**Logging:** Ensure Edge / app logs never print rotated feed token (only user-facing once).

---

## Phase 6 — Risk register (summary)

| ID | Severity | Article | Finding | Treatment |
|----|----------|---------|---------|-----------|
| R1 | CRITICAL (fixed v4) | 5 | Org-wide invitation emails in export | Narrowed filter |
| R2 | HIGH (fixed v4) | 5 | Raw auth UUIDs in option/client project flows | Pseudonym refs |
| R3 | HIGH (fixed v4) | 32 | Push token in export | `has_token` only |
| R4 | MEDIUM | 15 | `model_applications` / `security_events` not enumerated | Track as backlog / DPO |
| R5 | MEDIUM (fixed v4) | 5 | `user_calendar_events.owner_id` leaked other clients’ auth UUIDs when `owner_type='client'` | `owner_ref` — pseudonym for client rows, else stringified non-client `owner_id` |
| R6 | MEDIUM | 17 | Model row PII after auth delete | **Mitigated** for email on anonymize path; full model row remains agency asset |
| R7 | LOW | 15 | Export row limits | Disclosure |

---

## Phase 7 — Implemented fixes (this delivery)

- New migration: [supabase/migrations/20260824_gdpr_export_v4_minimization_anonymize_model.sql](supabase/migrations/20260824_gdpr_export_v4_minimization_anonymize_model.sql) — `export_user_data` **v4** + `anonymize_user_data` **model email clear**.
- Tests: [src/services/__tests__/dataExportService.test.ts](src/services/__tests__/dataExportService.test.ts), [src/services/__tests__/gdprComplianceSupabase.test.ts](src/services/__tests__/gdprComplianceSupabase.test.ts).
- Table map: [docs/GDPR_EXPORT_TABLE_MAP.md](docs/GDPR_EXPORT_TABLE_MAP.md) updated for v4.

---

## Phase 8 — Verdict

**partially_compliant**

- **Art. 15:** Strong coverage for core product tables; v4 removes major third-party leaks; residual gaps (security_events, thread prefs, calendar client `owner_id`, application forms) should be tracked.
- **Art. 5:** Improved with v4; metadata/audit entity refs still need policy.
- **Art. 17:** Hard delete + anonymize are **intentionally partial** for B2B records; model email anonymization strengthened; agency retention remains product/legal scope.
- **Art. 32:** Export authorization and feed-token handling align with good practice; push token removed from export payload.

**DPO / legal:** Confirm invitation minimization still satisfies operational needs; confirm model/commercial field exposure in export for model subjects.
