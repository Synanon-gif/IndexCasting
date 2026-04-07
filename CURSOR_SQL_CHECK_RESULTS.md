# CURSOR_SQL_CHECK_RESULTS.md

**Generated:** 2026-04-07T19:12:05.515Z
**Ref:** ispkfdqzjrfrilosoklu

## A1 — FOR ALL watchlist
**Purpose:** Expect 0 on watchlist tables

**Verdict:** **PASS** — none

**Rows:** 0

*(0 rows)*

---

## A2 — FOR ALL public
**Purpose:** Inventory

**Verdict:** **NEEDS_REVIEW** — 23 rows

**Rows:** 23

| tablename | policyname | cmd |
|---|---|---|
| agencies | service_role_agencies_all | ALL |
| agency_connections | agency_connections_manage_own | ALL |
| agency_usage_limits | admin_full_access_usage_limits | ALL |
| anon_rate_limits | No direct access – anon rate limit table | ALL |
| bookers | Agency can manage bookers | ALL |
| bookings | bookings_agency_org_all | ALL |
| client_preference_embeddings | Client embeddings owner only | ALL |
| client_project_models | Client org members can manage project models | ALL |
| client_projects | client_projects_org_member | ALL |
| documents | Users can manage own documents | ALL |
| follows | Users can manage own follows | ALL |
| guest_link_rate_limit | No direct access – rate limit table | ALL |
| model_claim_tokens | admin_full_access_model_claim_tokens | ALL |
| models | Service role full access models | ALL |
| organization_daily_usage | admin_full_access_daily_usage | ALL |
| organization_storage_usage | admin_full_access_storage_usage | ALL |
| organization_subscriptions | admin_full_access_subscriptions | ALL |
| post_comments | Users can manage own comments | ALL |
| post_likes | Users can manage own likes | ALL |
| posts | Users can manage own posts | ALL |
| streaks | Streaks owner only | ALL |
| stripe_processed_events | No direct access – stripe idempotency table | ALL |
| user_thread_preferences | user_thread_preferences_own | ALL |

---

## B — profiles in qual
**Purpose:** is_admin / profiles+role heuristic

**Verdict:** **NEEDS_REVIEW** — 3 policies match heuristic

**Rows:** 3

| tablename | policyname | cmd | q |
|---|---|---|---|
| agency_invitations | Agents can read own agency invitations | SELECT | ((EXISTS ( SELECT 1    FROM profiles p   WHERE ((p.id = auth.uid()) AND (p.role = 'agent'::text)))) AND (((agency_id IS NOT NULL) AND ((EXISTS ( SELECT 1    FROM ((agencies ag      JOIN organizations o ON ((o.agency_id = ag.id)))      JOIN organization_members om ON ((om.organization_id = o.id)))   WHERE ((ag.id = agency_invitations.agency_id) AND (om.user_id = auth.uid())))) OR (EXISTS ( SELECT 1 |
| agency_invitations | Agents can update own agency invitations | UPDATE | ((EXISTS ( SELECT 1    FROM profiles p   WHERE ((p.id = auth.uid()) AND (p.role = 'agent'::text)))) AND (agency_id IS NOT NULL) AND ((EXISTS ( SELECT 1    FROM ((agencies ag      JOIN organizations o ON ((o.agency_id = ag.id)))      JOIN organization_members om ON ((om.organization_id = o.id)))   WHERE ((ag.id = agency_invitations.agency_id) AND (om.user_id = auth.uid())))) OR (EXISTS ( SELECT 1   |
| model_photos | Clients see visible model photos | SELECT | ((is_visible_to_clients = true) AND has_platform_access() AND ((EXISTS ( SELECT 1    FROM profiles p   WHERE ((p.id = auth.uid()) AND (p.role = 'client'::text)))) OR (EXISTS ( SELECT 1    FROM (organizations o      JOIN organization_members om ON ((om.organization_id = o.id)))   WHERE ((o.type = 'client'::organization_type) AND (om.user_id = auth.uid())))) OR (EXISTS ( SELECT 1    FROM organizatio |

---

## C — MAT self-ref
**Purpose:** BLOCKER if rows

**Verdict:** **PASS** — no self-ref match

**Rows:** 0

*(0 rows)*

---

## D — email in qual
**Purpose:** triage

**Verdict:** **PASS** — empty OK

**Rows:** 0

*(0 rows)*

---

## E1 — SECDEF list
**Purpose:** proconfig

**Verdict:** **NEEDS_REVIEW** — 174 rows

**Rows:** 174

| fn | args | cfg |
|---|---|---|
| accept_guest_link_tos | p_link_id uuid | search_path=public |
| accept_organization_invitation | p_token text | search_path=public,row_security=off |
| add_model_assignments | p_model_id uuid, p_organization_id uuid, p_country_codes text[], p_role assignment_role | search_path=public,row_security=off |
| add_model_territories | p_model_id uuid, p_agency_id uuid, p_country_codes text[] | search_path=public,row_security=off |
| add_model_to_project | p_project_id uuid, p_model_id uuid | search_path=public,row_security=off |
| admin_backfill_all_no_org_accounts |  | search_path=public,row_security=off |
| admin_backfill_org_for_user | p_user_id uuid | search_path=public,row_security=off |
| admin_find_model_by_email | p_email text | search_path=public,row_security=off |
| admin_get_org_storage_usage | p_org_id uuid | search_path=public |
| admin_get_org_subscription | p_org_id uuid | search_path=public |
| admin_get_profiles | p_active_only boolean, p_inactive_only boolean, p_role text | search_path=public |
| admin_list_all_models |  | search_path=public |
| admin_list_org_memberships | p_target_user_id uuid | search_path=public |
| admin_list_organizations |  | search_path=public |
| admin_purge_user_data | target_id uuid | search_path=public |
| admin_reset_agency_swipe_count | p_organization_id uuid | search_path=public |
| admin_reset_to_default_storage_limit | p_organization_id uuid | search_path=public |
| admin_set_account_active | target_id uuid, active boolean, reason text | search_path=public |
| admin_set_agency_storage_usage | p_organization_id uuid, p_used_bytes bigint | search_path=public |
| admin_set_agency_swipe_limit | p_organization_id uuid, p_limit integer | search_path=public |
| admin_set_bypass_paywall | p_org_id uuid, p_bypass boolean, p_custom_plan text | search_path=public |
| admin_set_model_active | p_model_id uuid, p_active boolean | search_path=public |
| admin_set_org_active | p_org_id uuid, p_active boolean | search_path=public |
| admin_set_org_plan | p_org_id uuid, p_plan text, p_status text | search_path=public |
| admin_set_organization_member_role | p_target_user_id uuid, p_organization_id uuid, p_role org_member_role | search_path=public |
| admin_set_storage_limit | p_organization_id uuid, p_new_limit_bytes bigint | search_path=public |
| admin_set_unlimited_storage | p_organization_id uuid | search_path=public |
| admin_update_model_minor_flag | p_model_id uuid, p_is_minor boolean | search_path=public,row_security=off |
| admin_update_model_notes | p_model_id uuid, p_admin_notes text | search_path=public |
| admin_update_org_details | p_org_id uuid, p_name text, p_new_owner_id uuid, p_admin_notes text, p_clear_notes boolean | search_path=public |
| admin_update_profile | target_id uuid, field_name text, field_value text | search_path=public |
| admin_update_profile_full | target_id uuid, p_display_name text, p_email text, p_company_name text, p_phone text, p_website text, p_country text, p_role text, p_is_active boolean, p_is_admin boolean | search_path=public |
| agency_can_manage_recruiting_for_agency | p_agency_id uuid | search_path=public,row_security=off |
| agency_claim_unowned_model | p_model_id uuid, p_agency_relationship_status text, p_is_visible_fashion boolean, p_is_visible_commercial boolean | search_path=public,row_security=off |
| agency_confirm_client_price | p_request_id uuid | search_path=public |
| agency_link_model_to_user | p_model_id uuid, p_agency_id uuid, p_email text | search_path=public |
| agency_remove_model | p_model_id uuid, p_agency_id uuid | search_path=public |
| agency_start_recruiting_chat | p_application_id uuid, p_agency_id uuid, p_model_name text | search_path=public |
| agency_update_model_full | p_model_id uuid, p_name text, p_email text, p_phone text, p_city text, p_country text, p_country_code text, p_current_location text, p_height integer, p_bust integer, p_waist integer, p_hips integer, p_chest integer, p_legs_inseam integer, p_shoe_size integer, p_hair_color text, p_eye_color text, p_sex text, p_ethnicity text, p_categories text[], p_is_visible_fashion boolean, p_is_visible_commerci | search_path=public,row_security=off |
| agency_update_option_schedule | p_option_id uuid, p_date date, p_start_time text, p_end_time text | search_path=public |
| anonymize_user_data | p_user_id uuid | search_path=public |
| assert_is_admin |  | search_path=public |
| auto_create_agency_storage_usage |  | search_path=public |
| auto_create_agency_usage_limit |  | search_path=public |
| auto_create_org_subscription |  | search_path=public |

*truncated 129*

---

## E2 — SECDEF no row_security in proconfig
**Purpose:** heuristic review

**Verdict:** **NEEDS_REVIEW** — 109 SECDEF without row_security in proconfig

**Rows:** 109

| fn | args | proconfig |
|---|---|---|
| accept_guest_link_tos | p_link_id uuid | search_path=public |
| admin_get_org_storage_usage | p_org_id uuid | search_path=public |
| admin_get_org_subscription | p_org_id uuid | search_path=public |
| admin_get_profiles | p_active_only boolean, p_inactive_only boolean, p_role text | search_path=public |
| admin_list_all_models |  | search_path=public |
| admin_list_org_memberships | p_target_user_id uuid | search_path=public |
| admin_list_organizations |  | search_path=public |
| admin_purge_user_data | target_id uuid | search_path=public |
| admin_reset_agency_swipe_count | p_organization_id uuid | search_path=public |
| admin_reset_to_default_storage_limit | p_organization_id uuid | search_path=public |
| admin_set_account_active | target_id uuid, active boolean, reason text | search_path=public |
| admin_set_agency_storage_usage | p_organization_id uuid, p_used_bytes bigint | search_path=public |
| admin_set_agency_swipe_limit | p_organization_id uuid, p_limit integer | search_path=public |
| admin_set_bypass_paywall | p_org_id uuid, p_bypass boolean, p_custom_plan text | search_path=public |
| admin_set_model_active | p_model_id uuid, p_active boolean | search_path=public |
| admin_set_org_active | p_org_id uuid, p_active boolean | search_path=public |
| admin_set_org_plan | p_org_id uuid, p_plan text, p_status text | search_path=public |
| admin_set_organization_member_role | p_target_user_id uuid, p_organization_id uuid, p_role org_member_role | search_path=public |
| admin_set_storage_limit | p_organization_id uuid, p_new_limit_bytes bigint | search_path=public |
| admin_set_unlimited_storage | p_organization_id uuid | search_path=public |
| admin_update_model_notes | p_model_id uuid, p_admin_notes text | search_path=public |
| admin_update_org_details | p_org_id uuid, p_name text, p_new_owner_id uuid, p_admin_notes text, p_clear_notes boolean | search_path=public |
| admin_update_profile | target_id uuid, field_name text, field_value text | search_path=public |
| admin_update_profile_full | target_id uuid, p_display_name text, p_email text, p_company_name text, p_phone text, p_website text, p_country text, p_role text, p_is_active boolean, p_is_admin boolean | search_path=public |
| agency_confirm_client_price | p_request_id uuid | search_path=public |
| agency_link_model_to_user | p_model_id uuid, p_agency_id uuid, p_email text | search_path=public |
| agency_remove_model | p_model_id uuid, p_agency_id uuid | search_path=public |
| agency_start_recruiting_chat | p_application_id uuid, p_agency_id uuid, p_model_name text | search_path=public |
| agency_update_option_schedule | p_option_id uuid, p_date date, p_start_time text, p_end_time text | search_path=public |
| anonymize_user_data | p_user_id uuid | search_path=public |
| assert_is_admin |  | search_path=public |
| auto_create_agency_storage_usage |  | search_path=public |
| auto_create_agency_usage_limit |  | search_path=public |
| auto_create_org_subscription |  | search_path=public |
| cancel_account_deletion |  | search_path=public |
| check_anon_rate_limit | p_ip_hash text, p_bucket text, p_limit integer | search_path=public |
| check_calendar_conflict | p_model_id uuid, p_date date, p_start time without time zone, p_end time without time zone | search_path=public |
| cleanup_anon_rate_limits |  | search_path=public |
| client_accept_counter_offer | p_request_id uuid | search_path=public |
| decrement_agency_storage_usage | p_bytes bigint | search_path=public |
| delete_organization_data | p_org_id uuid | search_path=public |
| dissolve_organization | p_organization_id uuid | search_path=public |
| enforce_guest_link_rate_limit |  | search_path=public |
| ensure_agency_for_current_agent | p_company_name text | search_path=public |
| ensure_agency_for_current_agent |  | search_path=public |

*truncated 64*

---

## F — overloads
**Purpose:** drift hint

**Verdict:** **NEEDS_REVIEW** — 2 rows

**Rows:** 2

| proname | cnt |
|---|---|
| ensure_agency_for_current_agent | 2 |
| ensure_client_organization | 2 |

---

## G1 — constraints MAT+ML
**Purpose:** territory/location

**Verdict:** **NEEDS_REVIEW** — 8 rows

**Rows:** 8

| conname | typ | tbl | def |
|---|---|---|---|
| model_agency_territories_agency_id_fkey | f | model_agency_territories | FOREIGN KEY (agency_id) REFERENCES agencies(id) ON DELETE CASCADE |
| model_agency_territories_model_id_fkey | f | model_agency_territories | FOREIGN KEY (model_id) REFERENCES models(id) ON DELETE CASCADE |
| model_agency_territories_one_agency_per_territory | u | model_agency_territories | UNIQUE (model_id, country_code) |
| model_agency_territories_pkey | p | model_agency_territories | PRIMARY KEY (id) |
| model_locations_model_id_fkey | f | model_locations | FOREIGN KEY (model_id) REFERENCES models(id) ON DELETE CASCADE |
| model_locations_pkey | p | model_locations | PRIMARY KEY (id) |
| model_locations_source_check | c | model_locations | CHECK ((source = ANY (ARRAY['live'::text, 'current'::text, 'agency'::text]))) |
| unique_model_source | u | model_locations | UNIQUE (model_id, source) |

---

## G2 — model_locations unique
**Purpose:** (model_id, source)

**Verdict:** **PASS** — (model_id,source) style seen

**Rows:** 2

| conname | def |
|---|---|
| model_locations_pkey | PRIMARY KEY (id) |
| unique_model_source | UNIQUE (model_id, source) |

---

## H — admin helpers
**Purpose:** existence

**Verdict:** **PASS** — core helpers present

**Rows:** 5

| proname |
|---|
| assert_is_admin |
| get_own_admin_flags |
| is_current_user_admin |
| is_current_user_super_admin |
| log_failed_admin_attempt |

---

## I — storage policies
**Purpose:** snippet

**Verdict:** **PASS** — no direct public.models/profiles in snippet

**Rows:** 6

| tablename | policyname | cmd | snip |
|---|---|---|---|
| objects | chat_files_recruiting_select | SELECT | ((bucket_id = 'chat-files'::text) AND ((owner = auth.uid()) OR (((storage.foldername(name))[1] = 'chat'::text) AND (EXISTS ( SELECT 1    FROM conversations c   WHERE (((c.id)::text = (storage.foldername(objects.name))[2]) AND ((auth.uid())::text = ANY ((c.participant_ids)::text[])))))) OR (((storage |
| objects | chat_files_scoped_insert | INSERT | ((bucket_id = 'chat-files'::text) AND storage_can_insert_chat_files_object(bucket_id, name)) |
| objects | documentspictures_delete_own_model | DELETE | ((bucket_id = 'documentspictures'::text) AND ((owner = auth.uid()) OR (((storage.foldername(name))[1] = ANY (ARRAY['model-photos'::text, 'model-private-photos'::text])) AND can_agency_manage_model_photo((storage.foldername(name))[2])))) |
| objects | documentspictures_insert_own_model | INSERT | ((bucket_id = 'documentspictures'::text) AND ((((storage.foldername(name))[1] = ANY (ARRAY['model-photos'::text, 'model-private-photos'::text])) AND can_agency_manage_model_photo((storage.foldername(name))[2])) OR (((storage.foldername(name))[1] <> ALL (ARRAY['model-photos'::text, 'model-private-pho |
| objects | documentspictures_select_scoped | SELECT | ((bucket_id = 'documentspictures'::text) AND ((((storage.foldername(name))[1] = ANY (ARRAY['model-photos'::text, 'model-private-photos'::text])) AND can_view_model_photo_storage((storage.foldername(name))[2])) OR (((storage.foldername(name))[1] <> ALL (ARRAY['model-photos'::text, 'model-private-phot |
| objects | documentspictures_update_own_model | UPDATE | ((bucket_id = 'documentspictures'::text) AND ((owner = auth.uid()) OR (((storage.foldername(name))[1] = ANY (ARRAY['model-photos'::text, 'model-private-photos'::text])) AND can_agency_manage_model_photo((storage.foldername(name))[2])))) |

---

## J — triggers
**Purpose:** sample

**Verdict:** **NEEDS_REVIEW** — 38 rows

**Rows:** 38

| tbl | tgname | d |
|---|---|---|
| agencies | agencies_updated_at | CREATE TRIGGER agencies_updated_at BEFORE UPDATE ON public.agencies FOR EACH ROW EXECUTE FUNCTION set_updated_at() |
| agency_connections | agency_connections_updated_at | CREATE TRIGGER agency_connections_updated_at BEFORE UPDATE ON public.agency_connections FOR EACH ROW EXECUTE FUNCTION set_updated_at() |
| bookers | bookers_updated_at | CREATE TRIGGER bookers_updated_at BEFORE UPDATE ON public.bookers FOR EACH ROW EXECUTE FUNCTION set_updated_at() |
| booking_events | booking_events_updated_at | CREATE TRIGGER booking_events_updated_at BEFORE UPDATE ON public.booking_events FOR EACH ROW EXECUTE FUNCTION set_updated_at() |
| booking_events | trg_validate_booking_event_status | CREATE TRIGGER trg_validate_booking_event_status BEFORE UPDATE OF status ON public.booking_events FOR EACH ROW EXECUTE FUNCTION fn_validate_booking_event_status_transition() |
| booking_events | trg_validate_booking_event_transition | CREATE TRIGGER trg_validate_booking_event_transition BEFORE UPDATE ON public.booking_events FOR EACH ROW EXECUTE FUNCTION fn_validate_booking_event_transition() |
| bookings | bookings_updated_at | CREATE TRIGGER bookings_updated_at BEFORE UPDATE ON public.bookings FOR EACH ROW EXECUTE FUNCTION set_updated_at() |
| bookings | trg_booking_protect_legal_hold | CREATE TRIGGER trg_booking_protect_legal_hold BEFORE DELETE ON public.bookings FOR EACH ROW EXECUTE FUNCTION fn_booking_protect_legal_hold() |
| bookings | trg_booking_set_legal_hold | CREATE TRIGGER trg_booking_set_legal_hold BEFORE INSERT OR UPDATE ON public.bookings FOR EACH ROW EXECUTE FUNCTION fn_booking_set_legal_hold() |
| client_agency_connections | client_agency_connections_updated_at | CREATE TRIGGER client_agency_connections_updated_at BEFORE UPDATE ON public.client_agency_connections FOR EACH ROW EXECUTE FUNCTION set_updated_at() |
| client_projects | client_projects_updated_at | CREATE TRIGGER client_projects_updated_at BEFORE UPDATE ON public.client_projects FOR EACH ROW EXECUTE FUNCTION set_updated_at() |
| conversations | conversations_updated_at | CREATE TRIGGER conversations_updated_at BEFORE UPDATE ON public.conversations FOR EACH ROW EXECUTE FUNCTION set_updated_at() |
| model_applications | model_applications_updated_at | CREATE TRIGGER model_applications_updated_at BEFORE UPDATE ON public.model_applications FOR EACH ROW EXECUTE FUNCTION set_updated_at() |
| model_applications | tr_model_applications_enforce_profile_name | CREATE TRIGGER tr_model_applications_enforce_profile_name BEFORE INSERT OR UPDATE OF first_name, last_name, applicant_user_id ON public.model_applications FOR EACH ROW EXECUTE FUNCTION model_applicati |
| model_applications | tr_transfer_pending_territories | CREATE TRIGGER tr_transfer_pending_territories AFTER UPDATE OF status ON public.model_applications FOR EACH ROW EXECUTE FUNCTION fn_transfer_pending_territories() |
| model_locations | trg_model_locations_updated_at | CREATE TRIGGER trg_model_locations_updated_at BEFORE UPDATE ON public.model_locations FOR EACH ROW EXECUTE FUNCTION set_model_locations_updated_at() |
| models | models_updated_at | CREATE TRIGGER models_updated_at BEFORE UPDATE ON public.models FOR EACH ROW EXECUTE FUNCTION set_updated_at() |
| models | trg_model_user_id_changed | CREATE TRIGGER trg_model_user_id_changed AFTER UPDATE OF user_id ON public.models FOR EACH ROW EXECUTE FUNCTION sync_model_account_linked() |
| option_documents | enforce_option_document_uploaded_by | CREATE TRIGGER enforce_option_document_uploaded_by BEFORE INSERT ON public.option_documents FOR EACH ROW EXECUTE FUNCTION trg_set_option_document_uploaded_by() |
| option_request_messages | enforce_option_message_from_role | CREATE TRIGGER enforce_option_message_from_role BEFORE INSERT ON public.option_request_messages FOR EACH ROW EXECUTE FUNCTION trg_enforce_option_message_from_role() |
| option_requests | option_requests_updated_at | CREATE TRIGGER option_requests_updated_at BEFORE UPDATE ON public.option_requests FOR EACH ROW EXECUTE FUNCTION set_updated_at() |
| option_requests | tr_auto_booking_event_on_confirm | CREATE TRIGGER tr_auto_booking_event_on_confirm AFTER UPDATE OF status ON public.option_requests FOR EACH ROW EXECUTE FUNCTION fn_auto_create_booking_event_on_confirm() |
| option_requests | tr_cancel_calendar_on_option_rejected | CREATE TRIGGER tr_cancel_calendar_on_option_rejected AFTER UPDATE OF status ON public.option_requests FOR EACH ROW EXECUTE FUNCTION fn_cancel_calendar_on_option_rejected() |
| option_requests | tr_option_requests_schedule_sync | CREATE TRIGGER tr_option_requests_schedule_sync AFTER UPDATE OF requested_date, start_time, end_time ON public.option_requests FOR EACH ROW EXECUTE FUNCTION sync_option_dates_to_calendars() |
| option_requests | tr_option_requests_sync_calendars | CREATE TRIGGER tr_option_requests_sync_calendars AFTER INSERT OR UPDATE OF final_status ON public.option_requests FOR EACH ROW WHEN ((new.final_status = 'option_confirmed'::text)) EXECUTE FUNCTION syn |
| option_requests | trg_ensure_calendar_on_option_confirmed | CREATE TRIGGER trg_ensure_calendar_on_option_confirmed AFTER UPDATE ON public.option_requests FOR EACH ROW EXECUTE FUNCTION fn_ensure_calendar_on_option_confirmed() |
| option_requests | trg_validate_option_status | CREATE TRIGGER trg_validate_option_status BEFORE UPDATE OF status, final_status ON public.option_requests FOR EACH ROW EXECUTE FUNCTION fn_validate_option_status_transition() |
| organization_members | trg_validate_org_member_role | CREATE TRIGGER trg_validate_org_member_role BEFORE INSERT OR UPDATE OF role, organization_id ON public.organization_members FOR EACH ROW EXECUTE FUNCTION validate_org_member_role_for_type() |
| organization_subscriptions | trg_record_trial_email_hashes | CREATE TRIGGER trg_record_trial_email_hashes AFTER INSERT OR UPDATE OF trial_ends_at ON public.organization_subscriptions FOR EACH ROW EXECUTE FUNCTION record_trial_email_hashes() |
| organizations | trigger_auto_create_agency_storage_usage | CREATE TRIGGER trigger_auto_create_agency_storage_usage AFTER INSERT ON public.organizations FOR EACH ROW EXECUTE FUNCTION auto_create_agency_storage_usage() |
| organizations | trigger_auto_create_agency_usage_limit | CREATE TRIGGER trigger_auto_create_agency_usage_limit AFTER INSERT ON public.organizations FOR EACH ROW EXECUTE FUNCTION auto_create_agency_usage_limit() |
| organizations | trigger_auto_create_org_subscription | CREATE TRIGGER trigger_auto_create_org_subscription AFTER INSERT ON public.organizations FOR EACH ROW EXECUTE FUNCTION auto_create_org_subscription() |
| posts | posts_updated_at | CREATE TRIGGER posts_updated_at BEFORE UPDATE ON public.posts FOR EACH ROW EXECUTE FUNCTION set_updated_at() |
| profiles | profiles_updated_at | CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION set_updated_at() |
| profiles | trg_prevent_privilege_escalation | CREATE TRIGGER trg_prevent_privilege_escalation BEFORE UPDATE OF is_admin, role, is_super_admin ON public.profiles FOR EACH ROW EXECUTE FUNCTION prevent_privilege_escalation_on_profiles() |
| push_tokens | push_tokens_updated_at | CREATE TRIGGER push_tokens_updated_at BEFORE UPDATE ON public.push_tokens FOR EACH ROW EXECUTE FUNCTION set_push_tokens_updated_at() |
| user_calendar_events | user_calendar_events_updated_at | CREATE TRIGGER user_calendar_events_updated_at BEFORE UPDATE ON public.user_calendar_events FOR EACH ROW EXECUTE FUNCTION set_updated_at() |
| verifications | verifications_updated_at | CREATE TRIGGER verifications_updated_at BEFORE UPDATE ON public.verifications FOR EACH ROW EXECUTE FUNCTION set_updated_at() |

---

## K — all functions
**Purpose:** inventory

**Verdict:** **NEEDS_REVIEW** — 178 rows

**Rows:** 178

| fn | args | secdef |
|---|---|---|
| accept_guest_link_tos | p_link_id uuid | true |
| accept_organization_invitation | p_token text | true |
| add_model_assignments | p_model_id uuid, p_organization_id uuid, p_country_codes text[], p_role assignment_role | true |
| add_model_territories | p_model_id uuid, p_agency_id uuid, p_country_codes text[] | true |
| add_model_to_project | p_project_id uuid, p_model_id uuid | true |
| admin_backfill_all_no_org_accounts |  | true |
| admin_backfill_org_for_user | p_user_id uuid | true |
| admin_find_model_by_email | p_email text | true |
| admin_get_org_storage_usage | p_org_id uuid | true |
| admin_get_org_subscription | p_org_id uuid | true |
| admin_get_profiles | p_active_only boolean, p_inactive_only boolean, p_role text | true |
| admin_list_all_models |  | true |
| admin_list_org_memberships | p_target_user_id uuid | true |
| admin_list_organizations |  | true |
| admin_purge_user_data | target_id uuid | true |
| admin_reset_agency_swipe_count | p_organization_id uuid | true |
| admin_reset_to_default_storage_limit | p_organization_id uuid | true |
| admin_set_account_active | target_id uuid, active boolean, reason text | true |
| admin_set_agency_storage_usage | p_organization_id uuid, p_used_bytes bigint | true |
| admin_set_agency_swipe_limit | p_organization_id uuid, p_limit integer | true |
| admin_set_bypass_paywall | p_org_id uuid, p_bypass boolean, p_custom_plan text | true |
| admin_set_model_active | p_model_id uuid, p_active boolean | true |
| admin_set_org_active | p_org_id uuid, p_active boolean | true |
| admin_set_org_plan | p_org_id uuid, p_plan text, p_status text | true |
| admin_set_organization_member_role | p_target_user_id uuid, p_organization_id uuid, p_role org_member_role | true |
| admin_set_storage_limit | p_organization_id uuid, p_new_limit_bytes bigint | true |
| admin_set_unlimited_storage | p_organization_id uuid | true |
| admin_update_model_minor_flag | p_model_id uuid, p_is_minor boolean | true |
| admin_update_model_notes | p_model_id uuid, p_admin_notes text | true |
| admin_update_org_details | p_org_id uuid, p_name text, p_new_owner_id uuid, p_admin_notes text, p_clear_notes boolean | true |
| admin_update_profile | target_id uuid, field_name text, field_value text | true |
| admin_update_profile_full | target_id uuid, p_display_name text, p_email text, p_company_name text, p_phone text, p_website text, p_country text, p_role text, p_is_active boolean, p_is_admin boolean | true |
| agency_can_manage_recruiting_for_agency | p_agency_id uuid | true |
| agency_claim_unowned_model | p_model_id uuid, p_agency_relationship_status text, p_is_visible_fashion boolean, p_is_visible_commercial boolean | true |
| agency_confirm_client_price | p_request_id uuid | true |
| agency_link_model_to_user | p_model_id uuid, p_agency_id uuid, p_email text | true |
| agency_remove_model | p_model_id uuid, p_agency_id uuid | true |
| agency_start_recruiting_chat | p_application_id uuid, p_agency_id uuid, p_model_name text | true |
| agency_update_model_full | p_model_id uuid, p_name text, p_email text, p_phone text, p_city text, p_country text, p_country_code text, p_current_location text, p_height integer, p_bust integer, p_waist integer, p_hips integer, p_chest integer, p_legs_inseam integer, p_shoe_size integer, p_hair_color text, p_eye_color text, p_sex text, p_ethnicity text, p_categories text[], p_is_visible_fashion boolean, p_is_visible_commerci | true |
| agency_update_option_schedule | p_option_id uuid, p_date date, p_start_time text, p_end_time text | true |
| anonymize_user_data | p_user_id uuid | true |
| assert_is_admin |  | true |
| auto_create_agency_storage_usage |  | true |
| auto_create_agency_usage_limit |  | true |
| auto_create_org_subscription |  | true |

*truncated 133*

---

## L — no RLS tables
**Purpose:** public base tables

**Verdict:** **PASS** — only systemish without RLS

**Rows:** 0

*(0 rows)*

---

## M — get_models_near_location
**Purpose:** DISTINCT ON

**Verdict:** **PASS** — DISTINCT ON model_id found

**Rows:** 1

| def |
|---|
| CREATE OR REPLACE FUNCTION public.get_models_near_location(p_lat double precision, p_lng double precision, p_radius_km double precision DEFAULT 50, p_client_type text DEFAULT 'all'::text, p_from integer DEFAULT 0, p_to integer DEFAULT 999, p_category text DEFAULT NULL::text, p_sports_winter boolean DEFAULT false, p_sports_summer boolean DEFAULT false, p_height_min integer DEFAULT NULL::integer, p_ |

---

