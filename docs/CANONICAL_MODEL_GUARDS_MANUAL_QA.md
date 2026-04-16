# Canonical model guards — manual QA checklist

Use after changes to `get_public_agency_models`, `ensure_agency_model_direct_conversation`, `getModelsForAgencyFromSupabase`, or agency↔model chat entry points.

## Preconditions

- Staging or production-like Supabase with migration `20260904_shadow_paths_canonical_guards.sql` applied.
- Test agency with public profile (`organization_profiles.is_public = true`, org type `agency`).

## Cases

1. **Public agency roster (slug)**  
   Open public agency profile by slug. Models shown must have `agency_relationship_status = active` and either a linked account (`user_id` set) or a `model_agency_territories` row for that agency. Models that are only `pending_link` or lack both account link and MAT must **not** appear on the public page (they may still appear in the internal agency roster).

2. **New agency→model chat without MAT**  
   As agency user, attempt to start a direct chat with a model that has **no** `model_agency_territories` row for this agency (and is not covered by an existing `agency-model:{agencyId}:{modelId}` conversation). Expect failure with a clear in-app message (territory / representation wording), not a silent no-op.

3. **Legacy chat without MAT**  
   If a conversation already exists with `context_id = agency-model:…`, opening it from the messages list should still work (read path); product may show a footnote if the model is no longer on the canonical internal roster.

4. **Internal roster vs public**  
   Confirm at least one model with `pending_link` (or non-`active` relationship) that qualifies for internal roster appears in My Models / `getModelsForAgencyFromSupabase` flow but **not** on the public profile model grid.

5. **Dashboard without agency context**  
   With no resolved `agencyId`, agency dashboard model load should not show a global all-models list (empty or blocked state per product).

## Sign-off

Record environment, date, and pass/fail per row above.
