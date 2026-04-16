# GDPR export (`export_user_data`) — table map (v3)

This document classifies tables included in **`public.export_user_data`** (JSON keys are snake_case from RPC; `src/services/dataExportService.ts` maps them to camelCase and `domains`).

**Compatibility:** In v3, `domains.business` is an **object** (`optionRequests`, `optionRequestMessages`, …), not a bare array. App UI only checks export success (`ok`); the formatted download filename includes `v{exportVersion}` (e.g. `indexcasting-data-export-v3-…json`).

## A — Include when the row concerns the data subject

| Table / key | Notes |
|-------------|--------|
| `profiles` → `profile` | Own row only. |
| `consent_log` | |
| `legal_acceptances` | |
| `organization_members` (+ `organizations.name` as `org_name`) → `organizations` | Membership context for the subject’s orgs. |
| `notifications` | `user_id = subject`. |
| `activity_logs` | Actor `user_id = subject`. |
| `push_tokens` | |
| `image_rights_confirmations` | |
| `messages` → `messages_sent` / `messages_received` | Text/content of threads; `sender_id` exported as `sender_ref` (pseudonym). |
| `conversations` | Where subject is in `participant_ids` or `guest_user_id`; `participant_ids` exported as `participant_id_refs`; `created_by` → `created_by_ref`. |
| `recruiting_chat_threads` / `recruiting_chat_messages` | Creator or applicant. |
| `user_calendar_events` → `calendar_events` | Owner, creator, or org-shared via membership. |
| `calendar_entries` | Via linked model or option-request participation. |
| `option_requests` | Full product column set for rows where the subject is client, creator, booker, assignee, or linked model. |
| `option_request_messages` | Only if `option_request_visible_for_export_subject(request_id, subject)`; model-linked subjects omit rows with `visible_to_model = false` (parity with app). |
| `option_documents` | Same visibility as option messages. |
| `models` → `model_profile` | Rows with `user_id = subject` (`jsonb_agg` of full row JSON). |
| `model_photos` | For those models. |
| `client_projects` | Owner or org member. |
| `invitations` | Invite to subject email, created by subject, or for an org the subject belongs to; **`token` is never exported**. |
| `booking_events` | Creator, linked model user, or org member of `client_org_id` / `agency_org_id`; `created_by` → `created_by_ref`. |
| `audit_trail` | `user_id = subject` **or** `entity_id = subject`. |

## B — Partial / transformed

| Area | Treatment |
|------|-----------|
| B2B UUIDs | `sender_ref`, `participant_id_refs`, `created_by_ref`, `guest_user_ref`, booking `created_by_ref`: `self` or `p_<sha256-prefix>` — no raw third-party auth UUIDs. |
| `organizations` | Includes `org_name` for the subject’s memberships — not full foreign org dossiers. |
| `option_requests` (commercial fields) | Full row in v3 for all scoped participants; model-facing **UI** still hides prices — legal interpretation of Art. 15 for models is a DPO matter; technical policy: same DB row as other parties in scope. |

## C — Excluded (subject export)

- Other users’ full `profiles`.
- `invitations.token` (plaintext secret).
- Raw `conversations.participant_ids` and raw `messages.sender_id` in v3 (replaced by refs above).
- Org billing/Stripe tables without a direct subject column in scope (not enumerated in `get_user_related_tables()`).

## Related

- RPC: `supabase/migrations/20260823_gdpr_export_user_data_v3.sql`
- Visibility helper: `option_request_visible_for_export_subject` (admin export must not use `auth.uid()`-scoped visibility).
- Informational list: `public.get_user_related_tables()`.
