# CURSOR_MODEL_SAVE_PHONE_INCIDENT_REPORT

## 1. Executive summary

Agency model save failed with PostgreSQL **42703** (`column "phone" does not exist`) because **`agency_update_model_full`** attempted to update a non-existent **`public.models.phone`** column. The membership guard from 20260429 was correct; this was a deeper schema/RPC drift. The fix removes the `phone` assignment from the RPC `UPDATE`, keeps **`p_phone`** for API compatibility, and documents the invariant.

## 2. Exact root cause

In `agency_update_model_full`, the statement `UPDATE public.models SET ... phone = COALESCE(p_phone, phone), ...` referenced **`phone`**. **`public.models`** has no such column, as recorded in **`20260410_security_audit_model_column_revoke.sql`** (K-1: phone and birthday omitted from the revoke list because they are not on the table).

## 3. RPC / schema drift analysis

| Finding | Classification |
|---------|----------------|
| `phone` in `UPDATE` | **CONFIRMED_RPC_SCHEMA_DRIFT** — direct cause of 42703 |
| Other `UPDATE` columns vs K-1 list | **LOW** — no other phantom column names identified in the same block |

## 4. Frontend payload impact

**`AgencyControllerView`** sent `p_phone: updates.phone ?? null` but **`updates.phone` was never set**, so the value was always null. Removing the argument is cleanup only. Import/sync services did not rely on `p_phone` for merge paths checked in-repo.

## 5. What was fixed

- New migration **`20260430_agency_update_model_full_remove_models_phone.sql`**: same function signature and 20260429 guards; **`phone` line removed** from `UPDATE`; **`COMMENT ON FUNCTION`** updated.
- **`AgencyControllerView`**: removed dead **`p_phone`** from the save RPC call.
- **`auto-review.mdc`** and **`docs/MODEL_SAVE_LOCATION_CONSISTENCY.md`**: additive schema-alignment notes.

## 6. Rules decision

Real guardrail: **SECDEF RPCs that `UPDATE public.models` must only reference columns that exist on the live table.** Added as a bullet under the existing **`agency_update_model_full`** checklist in **`auto-review.mdc`**. **`.cursorrules`** / **`system-invariants.mdc`** not changed (local to this RPC class; auto-review is the right home).

## 7. Why Auth / Admin / Login stayed untouched

No changes to **`AuthContext`**, **`App.tsx`**, **`signIn`**, **`bootstrapThenLoadProfile`**, **`loadProfile`**, admin UUID/email RPCs, **`get_my_org_context`**, or paywall core. The edit is limited to **`agency_update_model_full`** body + one UI RPC payload line + docs/rules.

## 8. What must work reliably now

- **Agency single-model save** via **`agency_update_model_full`** after successful territory save, without **42703**.
- **Admins** still bypass membership via **`is_current_user_admin()`** (unchanged from 20260429).

## Follow-up

A one-off audit of **all** `UPDATE public.models` SECURITY DEFINER functions against **`information_schema.columns`** is useful later; it was out of scope for this minimal fix.
