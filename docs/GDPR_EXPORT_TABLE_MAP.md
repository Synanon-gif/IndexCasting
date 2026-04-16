# GDPR export (`export_user_data`) — table map (v4)

This document classifies tables included in **`public.export_user_data`** (JSON keys are snake_case from RPC; `src/services/dataExportService.ts` maps them to camelCase and `domains`).

**Compatibility:** `domains.business` is an **object** (`optionRequests`, `optionRequestMessages`, …). Filenames use `v{exportVersion}` (e.g. `indexcasting-data-export-v4-…json`).

**v4 minimization (Art. 5):** Invitations limited to the data subject’s email or invites they sent; option/client-project/calendar client party fields use `*_ref` pseudonyms where they were raw auth UUIDs; `push_tokens` export `has_token` instead of the raw device token.

## A — Include when the row concerns the data subject

| Table / key | Notes |
|-------------|--------|
| `profiles` → `profile` | Own row only. |
| `consent_log` | |
| `legal_acceptances` | |
| `organization_members` (+ `organizations.name` as `org_name`) → `organizations` | Membership context for the subject’s orgs. |
| `notifications` | `user_id = subject`. |
| `activity_logs` | Actor `user_id = subject`. |
| `push_tokens` | v4: `has_token` boolean; raw FCM/APNs string **not** exported. |
| `image_rights_confirmations` | |
| `messages` → `messages_sent` / `messages_received` | Text/content of threads; `sender_id` exported as `sender_ref` (pseudonym). |
| `conversations` | Where subject is in `participant_ids` or `guest_user_id`; `participant_ids` exported as `participant_id_refs`; `created_by` → `created_by_ref`. |
| `recruiting_chat_threads` / `recruiting_chat_messages` | Creator or applicant. |
| `user_calendar_events` → `calendar_events` | Owner, creator, or org-shared via membership; v4: `owner_ref` (pseudonym when `owner_type = 'client'`, else string id). |
| `calendar_entries` | Via linked model or option-request participation. |
| `option_requests` | Scoped rows; v4: `client_user_ref`, `booker_user_ref`, `created_by_ref`, `agency_assignee_ref` (no raw participant auth UUIDs). |
| `option_request_messages` | Visibility as v3; v4: `booker_ref` instead of raw `booker_id`. |
| `option_documents` | Same visibility; v4: `uploaded_by_ref` when value is a UUID string. |
| `models` → `model_profile` | Rows with `user_id = subject` (`jsonb_agg` of full row JSON). |
| `model_photos` | For those models. |
| `client_projects` | Owner or org member; v4: `owner_ref` instead of raw `owner_id`. |
| `invitations` | v4: invite **to** subject email (`lower(email)` match) **or** `invited_by = subject` only; **`token` is never exported**. |
| `booking_events` | Creator, linked model user, or org member of `client_org_id` / `agency_org_id`; `created_by` → `created_by_ref`. |
| `audit_trail` | `user_id = subject` **or** `entity_id = subject`. |

## B — Partial / transformed

| Area | Treatment |
|------|-----------|
| B2B UUIDs | Messages/conversations/booking: `sender_ref`, `participant_id_refs`, `created_by_ref`, `guest_user_ref`, `created_by_ref`; option rows: `*_user_ref` / `*_ref` as in v4. |
| `organizations` | Includes `org_name` for the subject’s memberships — not full foreign org dossiers. |
| `option_requests` (commercial fields) | Commercial columns still present for scoped rows; model-facing **UI** hides prices — DPO may require redaction for model-only exports. |

## C — Excluded (subject export)

- Other users’ full `profiles`.
- `invitations.token` (plaintext secret).
- Raw `conversations.participant_ids` and raw `messages.sender_id` (replaced by refs).
- Raw device push tokens (v4).
- Org billing/Stripe tables without a direct subject column in scope (not enumerated in `get_user_related_tables()`).

## ICS / subscription feed vs full export (Art. 15 transparency)

| Mechanism | Contents |
|-----------|----------|
| **`export_user_data` v4 (JSON)** | `calendar_events` (`user_calendar_events`), `calendar_entries`, **`booking_events`**, plus all other subject-scoped keys in the RPC. |
| **`.ics` download + webcal feed** | Same merged event set as internal `calendar_export_events_json`: **`user_calendar_events` ∪ `calendar_entries`** only. Does **not** add **`booking_events`** to the sync surface (by design — avoids duplicate / divergent lifecycle in external calendars). |

**User-facing:** Calendar sync is optional and **narrower** than the JSON export; full portable copy = **Download my data**. See [GDPR_CALENDAR_COMPLIANCE.md](./GDPR_CALENDAR_COMPLIANCE.md) and [CALENDAR_INTEROP_AUDIT_REPORT.md](./CALENDAR_INTEROP_AUDIT_REPORT.md).

## Related

- RPC: `supabase/migrations/20260824_gdpr_export_v4_minimization_anonymize_model.sql` (v4; helpers unchanged from v3 file)
- Prior: `20260823_gdpr_export_user_data_v3.sql`
- Visibility helper: `option_request_visible_for_export_subject` (admin export must not use `auth.uid()`-scoped visibility).
- Informational list: `public.get_user_related_tables()`.
