# RLS / org-invite audit backlog

Tracking document for the “global consistency” plan: full policy review vs `check_org_access()` / `is_current_user_admin()` is **not** complete in one pass. Use this list for staged work.

## Invite backend parity (verified references)

| Area | Enforcement | Reference |
|------|-------------|-----------|
| **Org invitations (`invitations`)** | INSERT/SELECT owner-only via `organization_members.role = 'owner'` | `supabase/migration_organizations_invitations_rls.sql` — policies `invitations_insert_owner`, `invitations_select_owner` |
| **Model claim token** | `generate_model_claim_token` — agency org member / legacy `agencies.owner_user_id`; `claim_model_by_token` — authenticated model user | `supabase/migrations/20260413_fix_c_model_claim_tokens.sql` |

If production ever diverges, add a **new** dated migration under `supabase/migrations/` that `DROP POLICY IF EXISTS` + recreates the above (do not edit legacy root SQL as source of truth).

## Verification queries (from `rls-security-patterns.mdc`)

Run against the project DB after policy changes:

1. No `profiles.is_admin = true` in policies:  
   `SELECT tablename, policyname FROM pg_policies WHERE qual ILIKE '%is_admin = true%';`

2. SECURITY DEFINER helpers used from RLS: confirm `row_security=off` in `pg_proc.proconfig` where applicable.

3. No self-referencing `model_agency_territories` policies (`self_mat`, `FROM model_agency_territories` in qual).

4. `FOR ALL` on watchlist tables (`model_embeddings`, `model_locations`, …): expect zero rows for listed tables.

## Next steps (optional tickets)

- Export `pg_policies` for all `public` tables and classify each policy as admin / org-scoped / self / helper.
- Align any straggler policies with `check_org_access()` or dedicated SECURITY DEFINER helpers per `system-invariants.mdc`.
