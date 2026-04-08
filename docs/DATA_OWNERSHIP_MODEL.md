# Data ownership model (user vs organization vs shared)

IndexCasting mixes **B2B org data**, **model portfolio data managed by agencies**, and **shared collaboration** (messages, bookings). This document fixes the product/legal framing for deletion and export.

## 1. User-owned (deleted or anonymized with the account)

- **Auth identity**: `auth.users` / `profiles` row for the account.
- **Personal settings**: consent logs, legal acceptances, push tokens, user-targeted notifications, personal activity/audit entries tied to `user_id`.
- **User-created messenger content**: `messages` rows where the user is `sender_id` (CASCADE on delete).
- **Personal calendar** (`user_calendar_events` scoped to the user as owner/creator where applicable).

## 2. Organization-owned (retained when the user leaves; deleted only on org delete where applicable)

- **Agency roster & model cards** managed by the agency: `models` rows, `model_photos`, territories, agency-set metadata — **not** wiped when a **booker** account is removed; when a **linked model account** is removed, `models.user_id` is **SET NULL** and the **agency keeps** the model record.
- **Org-level** data deleted via **`delete_organization_data`** (owner-only RPC): see [`migration_gdpr_compliance_2026_04.sql`](../supabase/migration_gdpr_compliance_2026_04.sql).

## 3. Shared / collaboration

- **B2B conversations** (`conversations` / `messages`): participants see threads per RLS; export includes messages where the user is a participant (`export_user_data` Phase 2).
- **Bookings / calendar entries** (`calendar_entries`, `booking_details` JSON): visibility is row-level plus **UI filtering** for brief fields — not field-level RLS; see [`BOOKING_BRIEF_SYSTEM.md`](./BOOKING_BRIEF_SYSTEM.md).
- **Option requests**: client, agency, and model roles may all hold legitimate copies in export when the user is a party (`client_id`, assignees, or linked model).

## Technical anchors

- **Edge Function** [`delete-user`](../supabase/functions/delete-user/index.ts): documents cascade vs explicit storage deletes.
- **RPC** `delete_organization_data`: org purge (owner-only).
- **RPC** `export_user_data`: Art. 15/20 bundle; `SECURITY DEFINER`, subject-scoped SELECTs only.
