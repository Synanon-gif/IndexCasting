# Supabase Migration Order

This file documents the **mandatory execution order** for all SQL files in this directory.
Files must be run in exactly this sequence on any new instance (staging, production clone, CI).

> **Important:** The current SQL files use a flat naming scheme without timestamps.
> A future refactor should move these into `supabase/migrations/` with the standard
> Supabase timestamp prefix format (`YYYYMMDDHHmmss_description.sql`) so that
> `supabase db push` can manage them automatically.

---

## Execution Order

### Phase 0 – Base Schema (run first, always)
1. `schema.sql`

### Phase 1 – Core Data Model
2. `migration_phase2_datamodel.sql`
3. `migration_phase3_rls_tighten.sql`
4. `migration_phase4_stippen.sql`
5. `migration_phase5_messenger.sql`
6. `migration_phase7_pro_tools.sql`
7. `migration_phase9_ai.sql`
8. `migration_phase11_enhancements.sql`
9. `migration_phase12_accounts.sql`
10. `migration_phase13_enhancements.sql`
11. `migration_phase14_options_jobs_castings.sql`

### Phase 2 – Agency & Model Features
12. `migration_agencies_code.sql`
13. `migration_models_unique_user_id.sql`
14. `migration_models_add_sex.sql`
15. `migration_model_categories.sql`
16. `migration_sports_categories.sql`
17. `migration_apply_model_and_email.sql`
18. `migration_model_applications_enforce_profile_name.sql`
19. `migration_model_applications_applicant_delete.sql`
20. `migration_model_roster_soft_delete.sql`
21. `migration_model_photos_is_visible_to_clients.sql`
22. `migration_model_photos_agency_owner_rls.sql`
23. `migration_model_photos_rls_tighten.sql`
24. `migration_models_with_territories_view.sql`
25. `migration_territories_add_rpc.sql`
26. `migration_territories_rls_agency_email_fix.sql`
27. `migration_territories_rpc_definitive.sql`
28. `migration_stabilize_model_agency_territories_unique_per_country_and_rls.sql`
29. `migration_model_agency_territories_multi_agency_client_select.sql`
30. `migration_hybrid_location_discovery_models_country_code_and_rls.sql`

### Phase 3 – Organizations & Invitations (Multi-Tenancy Core)
31. `migration_organizations_invitations_rls.sql`          ← Creates organizations, organization_members, invitations tables + RPCs
32. `migration_org_single_owner_invariant.sql`             ← Unique index: one owner per org
33. `migration_invitations_owner_only.sql`                 ← Tightens INSERT to owner only
34. `migration_org_members_select_any_member.sql`          ← OBSOLETE (no-op)
35. `migration_org_members_rls_no_recursion.sql`           ← Fixes infinite recursion via user_is_member_of_organization()
36. `migration_organizations_column_security.sql`
37. `migration_organizations_owner_can_update_name.sql`
38. `migration_org_member_settings_permissions.sql`
39. `migration_admin_organization_member_role.sql`
40. `migration_client_member_role_and_org_members_read_team.sql`

### Phase 4 – B2B Connections & Messenger
41. `migration_client_agency_connections_org_chat_rls.sql`
42. `migration_client_agency_connections_table_comment.sql`
43. `migration_connection_messenger_org_scope.sql`          ← Adds client_organization_id/agency_organization_id to conversations
44. `migration_conversations_insert_b2b_org_member.sql`
45. `migration_b2b_org_directory_and_pair_resolve.sql`
46. `migration_b2b_counterparty_org_name_rpc.sql`
47. `migration_rpc_create_b2b_org_conversation.sql`
48. `migration_resolve_b2b_chat_organization_ids.sql`
49. `migration_b2b_chat_message_types.sql`
50. `migration_b2b_chat_message_types_add_booking.sql`

### Phase 5 – Agency Bootstrap & Agent Features
51. `migration_ensure_agency_row_for_agent.sql`
52. `migration_ensure_plain_signup_b2b_owner_bootstrap.sql`  ← BUGGY – superseded by fix below
53. `migration_models_insert_agency_org_members.sql`
54. `migration_models_agency_member_full_access.sql`
55. `migration_agency_bookers_full_access.sql`
56. `migration_agency_settings_and_model_photos_rls.sql`
57. `migration_agency_start_recruiting_chat_rpc.sql`
58. `migration_agency_remove_model_and_admin_purge.sql`
59. `migration_recruiting_thread_agency.sql`
60. `migration_recruiting_threads_application_index.sql`

### Phase 6 – Calendar, Options & Bookings
61. `migration_user_calendar_events.sql`
62. `migration_user_calendar_events_org_member_rls.sql`
63. `migration_calendar_entries_multi_slot_rls_email.sql`
64. `migration_calendar_reschedule_sync.sql`
65. `migration_org_calendar_booking_full_access.sql`          ← Replaces calendar RLS with org-wide access
66. `migration_identity_negotiation_calendar.sql`
67. `migration_option_no_model_account.sql`
68. `migration_rls_fix_option_requests_safety.sql`            ← Safety net: drops broad USING(true) option policies

### Phase 7 – Client Features
69. `migration_client_filter_preset.sql`
70. `migration_client_projects_employees.sql`
71. `migration_client_discovery_consistency.sql`

### Phase 8 – Guest Links & Flow
72. `migration_guest_user_flow.sql`
73. `migration_guest_links_rls_fix.sql`
74. `migration_guest_links_rls_agency_scoped.sql`
75. `migration_guest_links_add_label.sql`
76. `migration_guest_links_fix_anon_models_rpc.sql`

### Phase 9 – Admin & Security Hardening
77. `migration_admin_profile_update.sql`
78. `migration_admin_update_profile_no_admin_escalation.sql`
79. `migration_security_tighten.sql`
80. `migration_system_hardening.sql`
81. `migration_organizations_invitations_rls.sql`  ← Already run in Phase 3; idempotent
82. `migration_rls_fix_agency_invitations_documents.sql`
83. `migration_rls_fix_anon_models.sql`
84. `migration_rls_fix_model_photos_territory.sql`
85. `migration_rls_fix_profiles_email.sql`         ← IMPORTANT: column-level email/phone security

### Phase 10 – Account Lifecycle
86. `migration_account_self_deletion.sql`
87. `migration_account_deletion_owner_only.sql`
88. `migration_backfill_b2b_organization_owners.sql`

### Phase 11 – Security Fixes (from Audit 2025)
89. `migration_fix_bootstrap_syntax.sql`           ← CRIT-1: Fixes missing END IF
90. `migration_invitations_delete_owner_only.sql`  ← HIGH-1: Owner can revoke invitations
91. `migration_fix_conversation_rls_perf.sql`      ← MED-3: row_security off in conversation helper
92. `migration_fix_connections_select_policy.sql`  ← MED-4: Fix broad connections SELECT
93. `migration_fix_org_owner_delete_restrict.sql`  ← MED-5: ON DELETE RESTRICT + transfer RPC
94. `migration_client_projects_org_scope.sql`      ← MED-1: Projects org-shared

### Phase 12 – Admin Org & Model Control
95. `migration_admin_org_model_control.sql`        ← Adds is_active + admin_notes to orgs & models; SECURITY DEFINER admin RPCs; org-deactivation gate RPC; get_models_by_location updated with is_active filter
96. `migration_admin_org_model_patch.sql`          ← PATCH: apply this instead of #95 if the REVOKE statements caused a rollback. Fully idempotent. No REVOKE commands.

### Phase 13 – Admin RLS Fix & Full B2B Backfill
97. `migration_admin_org_rls_and_full_backfill.sql` ← CRIT: Adds admin SELECT RLS on organizations + organization_members so fallback query works; creates agencies rows for agents without one; full idempotent backfill for all orphaned B2B profiles.

### Phase 14 – Monetization: Agency Swipe Limits
98. `migration_agency_swipe_limits.sql` ← Creates `agency_usage_limits` table; RLS (member SELECT + admin ALL); 4 SECURITY DEFINER RPCs (`get_my_agency_usage_limit`, `increment_my_agency_swipe_count`, `admin_set_agency_swipe_limit`, `admin_reset_agency_swipe_count`); AFTER INSERT trigger on `organizations` to auto-create limit row for new agency orgs; backfill for existing agency orgs.

### Phase 15 – Org Deduplication & Naming Fix
99. `migration_fix_org_naming_and_dedup.sql` ← **v2** – Priority-based dedup for ALL duplicate cases (both agency_id IS NULL orphans AND cases where both orgs have agency_id IS NOT NULL but same owner): keeps org whose name ≠ owner display_name, tie-breaks by oldest created_at; moves members before deleting; defensive client dedup; adds UNIQUE(owner_id) WHERE type='agency'; fixes ensure_agency_for_current_agent() and ensure_client_organization() (no display_name fallback); syncs organizations.name from agencies.name for linked orgs.

### Phase 16 – New Tables: Locations, Media Sync, Security, Notifications, Push
100. `migration_model_locations.sql`                      ← Creates `model_locations` table (privacy-safe approx coords); UNIQUE(model_id); RLS: model self + agency members
101. `migration_mediaslide_sync_logs.sql`                 ← Creates `mediaslide_sync_logs` table; RLS: agency read (fixed below) + restricted INSERT
102. `migration_security_events.sql`                      ← Creates `security_events` table (append-only audit log); RLS: INSERT own only, SELECT admin/service
103. `migration_push_tokens.sql`                          ← Creates `push_tokens` table; UNIQUE(user_id, token); RLS: own tokens only
104. `migration_notifications.sql`                        ← Creates `notifications` table; RLS: read own/org + insert authenticated
105. `migration_client_model_interactions.sql`            ← Creates `client_model_interactions` + `discovery_logs` tables; RPCs `record_client_interaction` + `get_discovery_models`
106. `migration_chat_file_attachments.sql`                ← ALTER `recruiting_chat_messages` ADD file_url, file_type

### Phase 17 – Agency API Keys & Mediaslide RLS Fix
107. `migration_agency_api_keys_rls.sql`                  ← SECURITY DEFINER RPCs `get_agency_api_keys` + `save_agency_api_connection`; column-level API key protection
108. `migration_agency_api_keys_grant_execute.sql`        ← GRANT EXECUTE on API key RPCs to authenticated role
109. `migration_fix_mediaslide_sync_logs_rls.sql`         ← Fixes broken SELECT policy (wrong agency join) + too-broad INSERT (was WITH CHECK(true))

### Phase 18 – Location RPCs
110. `migration_model_locations_rpcs.sql`                 ← RPCs: `upsert_model_location`, `bulk_upsert_model_locations`, `get_models_near_location`, `get_models_by_location` v3
111. `migration_model_locations_rpc_bbox_optimization.sql` ← Replaces `get_models_near_location` with bbox pre-filter (lat/lng range → Haversine only on survivors)
112. `migration_get_models_by_location_rpc.sql`           ← RPC v1: UNION-query replacing dual pagination loops; territory OR country_code matching
113. `migration_get_models_by_location_rpc_v2.sql`        ← RPC v2: territory-only discovery (removes country_code fallback); aligns with product rule

### Phase 19 – Models RLS Stabilization & Application Fixes
114. `migration_models_rls_clients_via_territories.sql`   ← Drops broad USING(true); clients see only models with ≥1 territory + visibility flag; agencies see own models
115. `migration_fix_model_applications_rls.sql`           ← SECURITY FIX: replaces USING(true) UPDATE + INSERT; applicant_user_id must match auth.uid()
116. `migration_model_application_country_rls.sql`        ← Adds `country_code` to model_applications; fixes SELECT so agency sees all applications (not only agency_id-matched)
117. `migration_application_model_confirmation.sql`       ← **Run alone (separate transaction)**: ALTER TYPE application_status ADD VALUE 'pending_model_confirmation'
118. `migration_application_model_confirmation_rls.sql`   ← Run AFTER #117 is committed: tightens UPDATE policy to allow applicant to accept/reject at pending_model_confirmation

### Phase 20 – Territories Bulk RPC & Client Discovery RLS
119. `migration_add_territories_bulk_rpc.sql`             ← RPCs: `bulk_add_model_territories` + `bulk_save_model_territories` (replaces N×1 RPC loops)
120. `migration_fix_client_rls_territory_required.sql`    ← Removes `country_code IS NOT NULL` shortcut; territory entry is the only valid representation scope
121. `migration_fix_client_rls_three_mandatory_fields.sql` ← Extends #120: requires name + territory + portfolio photo before model is visible to clients

### Phase 21 – Client Interaction v2 & Org Enforcement
122. `migration_client_model_interactions_v2.sql`         ← Upgrades interaction table from 3 rows to 1 row per (org, model); PK = (client_org_id, model_id); updates both RPCs
123. `migration_enforce_single_org_per_user.sql`          ← Cleans up multi-membership violations; adds partial UNIQUE INDEX on organization_members for single-org enforcement

### Phase 22 – Media System & Polaroid Privacy
124. `migration_model_media_system.sql`                   ← Extends photo_type ('private'); adds agency_id to model_photos; adds include_polaroids to guest_links; updates get_guest_link_models RPC; private photos never visible to clients/anon
125. `migration_package_type_system.sql`                  ← Replaces include_polaroids bool with strict type enum ('portfolio' | 'polaroid'); updates RPC accordingly
126. `migration_polaroids_discovery_restriction.sql`      ← Client + anon SELECT on model_photos: adds photo_type != 'polaroid' guard; polaroids only via get_guest_link_models RPC

### Phase 23 – Workflow Hardening & Security Audit Fixes
127. `migration_request_workflow_hardening.sql`           ← Performance indexes on option_requests; RLS hardening for legacy bookings (was USING(true)); RLS hardening for calendar_entries; CHECK constraint for counter-offer state
128. `migration_security_hardening_audit_fixes.sql`       ← Run AFTER #102 + #127: fixes bookings_select_scoped (removes unscoped org-member branch); fixes calendar_entries INSERT bypass; revokes replication_slot_health from authenticated; scopes security_events INSERT to user's own orgs

### Phase 24 – Account Lifecycle & Performance
129. `migration_personal_account_deletion.sql`            ← SECURITY DEFINER RPC `request_personal_account_deletion`; allows non-owner members to soft-delete their own account; complements migration_account_deletion_owner_only.sql
130. `migration_performance_indexes.sql`                  ← 100k-scale indexes on bookings, option_requests, model_photos, model_agency_territories, conversations, messages, etc.
131. `migration_performance_indexes_v2.sql`               ← Additional indexes: profiles(created_at), messages(conversation_id, created_at), model_photos(model_id, photo_type)

### Phase 25 – Input Validation & Ethnicity Extension
132. `migration_validation_constraints.sql`               ← CHECK constraints on text length (messages, option_request_messages) + file_type whitelists; enforced at PostgreSQL level independent of frontend
133. `migration_add_ethnicity.sql`                        ← Adds `ethnicity` column to models + model_applications; extends get_models_by_location RPC with p_ethnicities filter

### Phase 26 – Security Fix: Notification Injection
134. `migration_fix_notifications_insert_rls.sql`         ← Replaces overly-broad notifications INSERT policy; restricts targets to caller's own user_id or orgs they belong to; cross-party notifications require org membership

### Phase 27 – Data Consistency Fixes
135. `migration_fix_model_account_linked_trigger.sql`     ← AFTER UPDATE OF user_id ON models trigger: syncs option_requests.model_account_linked when a model account is later linked (prevents approval bypass for retrospectively linked models)
136. `migration_fix_option_requests_org_id_comment.sql`   ← COMMENT ON COLUMN option_requests.organization_id documenting Client-Org semantics (NOT agency org)

### Phase 28 – Agency Storage Tracking
137. `migration_agency_storage_tracking.sql`              ← Creates `organization_storage_usage` table (PK=organization_id, used_bytes≥0); RLS (member SELECT + admin ALL); 6 SECURITY DEFINER RPCs: `get_my_agency_storage_usage`, `increment_agency_storage_usage` (atomic limit check with FOR UPDATE, 5 GB cap), `decrement_agency_storage_usage` (floors at 0), `get_chat_thread_file_paths`, `get_model_portfolio_file_paths`, `admin_set_agency_storage_usage`; AFTER INSERT trigger on `organizations` to auto-create storage row for new agency orgs; backfill for existing agency orgs. Applies to agency organizations only — clients and models are unrestricted.

### Phase 28b – Storage Security Hardening
138. `migration_storage_size_hardening.sql`               ← Security audit fixes: (1) `ALTER TABLE model_photos/documents ADD COLUMN file_size_bytes BIGINT DEFAULT 0` — enables reliable storage decrement from DB instead of fragile `storage.list()` calls; (2) `CREATE OR REPLACE FUNCTION get_chat_thread_file_paths` — adds ownership check (conversation must belong to caller's agency org, preventing cross-agency file path enumeration — BUG 2 HIGH); (3) `CREATE OR REPLACE FUNCTION get_model_portfolio_file_paths` — adds ownership check via `organizations.agency_id = models.agency_id` join (BUG 2 HIGH); (4) `CREATE OR REPLACE FUNCTION decrement_agency_storage_usage` — adds audit log to `security_events` for single-call decrements > 100 MB (BUG 4 LOW mitigation). Run after Phase 28.

### Phase 29 – Pre-Launch Security Fixes (2026-04 Audit)
139. `migration_prelaunch_security_fixes.sql`             ← C-3: replaces broad anon/auth SELECT policies on guest_links with agency-scoped policy + SECURITY DEFINER `get_guest_link_info()` RPC for anon callers; H-2: removes anon model_locations SELECT, scopes auth SELECT to agency/client relationships; H-3: replaces chat-files storage SELECT with owner + conversation-participant check; H-4: adds `m.agency_id = v_agency_id` guard to `get_guest_link_models()` RPC; H-7: scopes agency_invitations policies from role='agent' to own-agency-membership check; M-1: adds partial UNIQUE index `uidx_booking_events_model_date_active` on (model_id, date) WHERE status != 'cancelled'. Run after Phase 28b.
140. `migration_notifications_rpc_hardening.sql`          ← M-3: replaces broad cross-party notifications INSERT policy with strict self/org-only policy; adds SECURITY DEFINER `send_notification()` RPC that validates sender↔target relationship (option_request, recruiting_thread, or B2B connection) before inserting. Run after Phase 29 (#139).

### Phase 29b – Admin Storage Override
141. `migration_admin_storage_override.sql`               ← Extends `organization_storage_usage` with `storage_limit_bytes` (nullable, NULL = default 5 GB) and `is_unlimited` (boolean); REPLACE `get_my_agency_storage_usage` + `increment_agency_storage_usage` to respect new columns; NEW SECURITY DEFINER admin RPCs: `admin_get_org_storage_usage` (read snapshot), `admin_set_storage_limit` (custom bytes, max 1 TB), `admin_set_unlimited_storage` (bypass limit), `admin_reset_to_default_storage_limit` (restore 5 GB). All admin RPCs verify `profiles.is_admin = TRUE` via `auth.uid()`. Run after Phase 29 (#140).

### Phase 29c – Portfolio Bulk-Delete Size Fix
142. `migration_fix_portfolio_bulk_delete_size.sql`       ← REPLACE `get_model_portfolio_file_paths`: uses `model_photos.file_size_bytes` (stored at upload time, Phase 28b) as the primary size source with `COALESCE(NULLIF(..., 0), storage.objects lookup, 0)` fallback. Fixes counter staying inflated when portfolio files were already removed from storage before bulk-delete. Run after Phase 29b (#141).

---

## Files NOT to run in production

- `assign_ami_to_johannes.sql` – one-off data assignment
- `diag_agency_recruiting_chat.sql` – diagnostic query only
- `diag_rls_open_policies_audit.sql` – diagnostic query only
- `monitoring_replication_slots.sql` – monitoring view; access revoked from authenticated in Phase 23 (#128)
- `seed_agencies.sql` – staging/dev seed data only
- `seed_models.sql` – staging/dev seed data only
- `scripts/cleanup_orphan_data_after_auth_delete.sql` – run manually as needed

---

## Verification Queries (run after full migration)

```sql
-- 1. Check for residual broad USING(true) policies
SELECT tablename, policyname, cmd, qual
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('client_agency_connections', 'option_requests', 'model_applications')
  AND (qual = 'true' OR with_check = 'true')
ORDER BY tablename, policyname;

-- 2. Duplicate owners (should return 0 rows)
SELECT organization_id, COUNT(*)
FROM organization_members WHERE role = 'owner'
GROUP BY 1 HAVING COUNT(*) > 1;

-- 3. Organizations without owner member (should return 0 rows)
SELECT o.id, o.name FROM organizations o
WHERE NOT EXISTS (
  SELECT 1 FROM organization_members m
  WHERE m.organization_id = o.id AND m.role = 'owner'
);

-- 4. Users without org (possible broken bootstrap — investigate)
SELECT p.id, p.role, p.created_at FROM profiles p
WHERE p.role IN ('client', 'agent')
  AND p.is_guest IS DISTINCT FROM true
  AND NOT EXISTS (SELECT 1 FROM organization_members m WHERE m.user_id = p.id);
```
