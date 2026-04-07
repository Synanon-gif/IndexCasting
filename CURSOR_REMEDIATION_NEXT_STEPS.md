# CURSOR_REMEDIATION_NEXT_STEPS

Die Datei `CURSOR_REMEDIATION_NEXT_STEPS.json` konnte im Plan-Modus nicht geschrieben werden. Inhalt zum Umbenennen nach `.json`:

```json
{
  "generated": "2026-04-07",
  "label_after_apply": "SAFE REMEDIATION APPLIED",
  "fixed_now": [
    "agency_invitations policy Agents can read own agency invitations — profiles.role removed, agency org + bookers parity with models",
    "agency_invitations policy Agents can update own agency invitations — same + WITH CHECK preserved",
    "model_photos policy Clients see visible model photos — caller_is_client_org_member() replaces profiles.role + redundant org ORs"
  ],
  "safe_next": [
    "Apply migration 20260426_remediation_three_policies_no_profiles_rls.sql via Supabase CLI/API",
    "Run CURSOR_REMEDIATION_SQL_VERIFY.md queries on production/staging",
    "Manual login matrix: T-LOGIN-ADMIN, T-LOGIN-AGENCY-OWNER, T-LOGIN-AGENCY-BOOKER, T-LOGIN-CLIENT-OWNER, T-LOGIN-CLIENT-EMP, T-LOGIN-MODEL",
    "Feature smoke: read/update agency_invitations; client visible model_photos with subscription"
  ],
  "manual_review_required": [
    "agency_invitations Agents can insert own agency invitations — still uses profiles.role = agent in live/repo",
    "recruiting_chat_threads / recruiting_chat_messages — email branches in pentest migration vs 20260405 fix; reconcile live drift",
    "SECDEF functions without row_security in proconfig — per-function review (no blanket ALTER)"
  ],
  "do_not_touch": [
    "AuthContext.tsx signIn / bootstrapThenLoadProfile / loadProfile",
    "App.tsx admin routing branch",
    "get_own_admin_flags / is_current_user_admin / assert_is_admin",
    "get_my_org_context semantics and LIMIT rules",
    "Blanket changes to all SECURITY DEFINER functions",
    "M-006 / M-009 / M-016 areas per CURSOR_FIX_PLAN_DO_NOT_BREAK.md"
  ]
}
```
