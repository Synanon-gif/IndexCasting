/**
 * Canonical entry points for **creating** `models` rows — thin re-exports only (no extra logic).
 *
 * IndexCasting uses multiple legitimate creation paths; do not route everything through one RPC.
 *
 * | Use case | Mechanism | Typical caller |
 * |----------|-----------|----------------|
 * | Agency manual add, Mediaslide/Netwalk import, merge-by-email | `importModelAndMerge` → direct `INSERT` where RLS allows agency members | [`AgencyControllerView`](../views/AgencyControllerView.tsx), sync services |
 * | Application accepted — applicant may lack agency `models` INSERT via RLS | `createModelFromApplication` → RPC `create_model_from_accepted_application` (SECURITY DEFINER) | Application accept flow in [`applicationsSupabase`](./applicationsSupabase.ts) consumers |
 *
 * Claim linking (existing model → user account) is **not** creation: use `claimModelByToken` / `generateModelClaimToken` in [`modelsSupabase`](./modelsSupabase.ts).
 *
 * New features should call these exports or the underlying modules — avoid a second direct `INSERT` on `models` without review (RLS + territory invariants).
 */

export {
  importModelAndMerge,
  type ImportModelAndMergeResult,
  type ImportModelPayload,
  type ModelMergeTerritoryInput,
} from './modelsImportSupabase';

export { createModelFromApplication } from './applicationsSupabase';
