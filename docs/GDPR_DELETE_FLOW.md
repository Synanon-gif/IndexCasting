# GDPR — Account & data deletion flow (Art. 17)

This document describes what happens when a **user account** is removed versus **organization** deletion and **anonymization** paths. It is descriptive of the intended system behavior; verify live FK definitions after schema changes.

## User account deletion (Edge Function `delete-user`)

1. **Explicit storage cleanup** (not covered by DB cascades): objects under `documents/{userId}/` and `verifications/{userId}/` in the configured buckets (see [`supabase/functions/delete-user/index.ts`](../supabase/functions/delete-user/index.ts)).
2. **`auth.admin.deleteUser(targetUserId)`** — removes the row in `auth.users`.
3. **Cascades from `auth.users`** (typical; confirm on live DB): tables that reference `auth.users(id) ON DELETE CASCADE` lose those rows — e.g. `profiles`, `push_tokens` (where `user_id` is set), user-targeted `notifications` (`user_id` set), `activity_logs` where `user_id` references auth users, `legal_acceptances`, `consent_log`, `messages` where `sender_id` references the user, etc.

## Messenger (`messages` / `conversations`)

- **`messages.sender_id`** references `auth.users` with **`ON DELETE CASCADE`** — messages sent by the deleted user are removed.
- **`conversations`** store participants in **`participant_ids UUID[]`** without a foreign key to users. After account deletion, **other participants’ conversations may still exist**, and the deleted user’s UUID can remain in `participant_ids` until a future cleanup migration (documented gap; not an RLS change).

## Recruiting chat

- Threads and messages tied to **org deletion** are covered by [`delete_organization_data`](../supabase/migration_gdpr_compliance_2026_04.sql) (agency/client org purge).
- **User-only delete** does not automatically delete recruiting threads owned by an agency; message rows sent by the user may be removed via CASCADE on `sender_id` where present; thread content may remain for the counterparty where business retention applies.

## Notifications

- Rows with **`notifications.user_id = deleted user`** CASCADE with the user.
- Rows targeting **only** `organization_id` (no `user_id`) are **not** deleted when one member leaves — they are org-scoped.

## Activity logs

- **`activity_logs.user_id`** references `auth.users` with **`ON DELETE CASCADE`** (see [`migration_activity_logs.sql`](../supabase/migration_activity_logs.sql)) — user’s log rows are removed on account deletion.

## Models & agency-owned content

- **`models.user_id`** is set to **`NULL`** on user delete (not CASCADE delete of the model row) — the **agency retains** the model record and portfolio data; see [`DATA_OWNERSHIP_MODEL.md`](./DATA_OWNERSHIP_MODEL.md).

## Anonymization (`anonymize_user_data`)

- Soft path for cases where hard delete is not possible (e.g. legal hold): profile fields anonymized, some chat content redacted per RPC definition (see [`migration_compliance_hardening_2026_04.sql`](../supabase/migration_compliance_hardening_2026_04.sql)).

## Orphan diagnostics

- Optional script: [`supabase/scripts/cleanup_orphan_data_after_auth_delete.sql`](../supabase/scripts/cleanup_orphan_data_after_auth_delete.sql) — operational cleanup hints after auth deletes (not automatic in app).
