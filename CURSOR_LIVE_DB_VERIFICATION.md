# CURSOR_LIVE_DB_VERIFICATION.md

**Generated:** 2026-04-13T18:16:23.166Z
**Ref:** ispkfdqzjrfrilosoklu

## 1. Executive Summary

Recommendation: **NEEDS_ATTENTION**. Critical: 0, High: 0, Heuristic: 1.

See CURSOR_SQL_CHECK_RESULTS.md.

## 2. Confirmed Critical Risks

*None.*

## 3. Confirmed High Risks

*None.*

## 4. Heuristic / Needs Review

[
  {
    "id": "secdef-proconfig",
    "area": "secdef",
    "severity": "medium",
    "confirmed": true,
    "evidence": "95 functions",
    "affected_objects": [
      "accept_guest_link_tos",
      "admin_get_org_storage_usage",
      "admin_get_org_subscription",
      "admin_get_profiles",
      "admin_list_all_models",
      "admin_list_org_memberships",
      "admin_list_organizations",
      "admin_purge_user_data",
      "admin_reset_agency_swipe_count",
      "admin_reset_to_default_storage_limit",
      "admin_set_account_active",
      "admin_set_agency_storage_usage",
      "admin_set_agency_swipe_limit",
      "admin_set_bypass_paywall",
      "admin_set_model_active",
      "admin_set_org_active",
      "admin_set_org_plan",
      "admin_set_organization_member_role",
      "admin_set_storage_limit",
      "admin_set_unlimited_storage",
      "admin_update_model_notes",
      "admin_update_org_details",
      "admin_update_profile",
      "admin_update_profile_full",
      "agency_link_model_to_user",
      "agency_remove_model",
      "agency_start_recruiting_chat",
      "agency_update_option_schedule",
      "anonymize_user_data",
      "assert_is_admin",
      "auto_create_agency_storage_usage",
      "auto_create_agency_usage_limit",
      "auto_create_org_subscription",
      "cancel_account_deletion",
      "check_anon_rate_limit"
    ],
    "login_risk": "low",
    "admin_risk": "low",
    "rls_risk": "medium",
    "org_isolation_risk": "medium",
    "note": "Review bodies"
  }
]

## 5. Confirmed No-Issue Areas

[
  {
    "id": "for-all-watchlist",
    "area": "policy",
    "severity": "info",
    "confirmed": true,
    "evidence": "A1 zero rows",
    "affected_objects": [],
    "login_risk": "low",
    "admin_risk": "low",
    "rls_risk": "low",
    "org_isolation_risk": "low",
    "note": ""
  },
  {
    "id": "mat-selfref",
    "area": "recursion",
    "severity": "info",
    "confirmed": true,
    "evidence": "C zero rows",
    "affected_objects": [],
    "login_risk": "low",
    "admin_risk": "low",
    "rls_risk": "low",
    "org_isolation_risk": "low",
    "note": "heuristic string match only"
  },
  {
    "id": "profiles-policy",
    "area": "policy",
    "severity": "info",
    "confirmed": true,
    "evidence": "B zero rows",
    "affected_objects": [],
    "login_risk": "low",
    "admin_risk": "low",
    "rls_risk": "low",
    "org_isolation_risk": "low",
    "note": ""
  },
  {
    "id": "storage",
    "area": "storage",
    "severity": "info",
    "confirmed": true,
    "evidence": "no models/profiles in snippet",
    "affected_objects": [],
    "login_risk": "low",
    "admin_risk": "low",
    "rls_risk": "low",
    "org_isolation_risk": "low",
    "note": ""
  }
]

## 6. Live Drift vs Repo

Not auto-diffed to migrations. Use query F/K in SQL results.

[
  {
    "id": "overloads",
    "area": "rpc",
    "severity": "low",
    "confirmed": true,
    "evidence": "2 rows",
    "affected_objects": [
      "enforce_guest_link_rate_limit(2)",
      "get_discovery_models(2)"
    ],
    "login_risk": "low",
    "admin_risk": "low",
    "rls_risk": "low",
    "org_isolation_risk": "low",
    "note": ""
  }
]

## 7. Recommendation

**NEEDS_ATTENTION**
