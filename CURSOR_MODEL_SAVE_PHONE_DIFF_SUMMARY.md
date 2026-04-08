# CURSOR_MODEL_SAVE_PHONE_DIFF_SUMMARY

| File | Purpose | Risk | Tests |
|------|---------|------|-------|
| `supabase/migrations/20260430_agency_update_model_full_remove_models_phone.sql` | Removes nonexistent `models.phone` from `agency_update_model_full` UPDATE; keeps `p_phone` param | Low — aligns RPC with documented schema; no auth/RLS change | Manual / live verify RPC; `npm test` unchanged coverage |
| `src/views/AgencyControllerView.tsx` | Drops misleading `p_phone` from save RPC payload | Low — field was never populated | UI save path manual |
| `.cursor/rules/auto-review.mdc` | Guardrail: RPC UPDATE columns must exist on `models` | Doc only | — |
| `docs/MODEL_SAVE_LOCATION_CONSISTENCY.md` | Notes `p_phone` compat-only | Doc only | — |
| `CURSOR_MODEL_SAVE_PHONE_*.md` / `.json` | Incident / verify / plan artefacts | Doc only | — |
