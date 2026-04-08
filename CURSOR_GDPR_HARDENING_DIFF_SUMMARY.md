# CURSOR — GDPR Hardening Phase 2 Diff Summary

| Area | Change |
|------|--------|
| DB | New migration `supabase/migrations/20260511_gdpr_export_user_data_phase2.sql` — `CREATE OR REPLACE FUNCTION export_user_data` |
| TS | New `src/services/dataExportService.ts`; `gdprComplianceSupabase.ts` export/download wiring |
| Tests | New `src/services/__tests__/dataExportService.test.ts` |
| UI | `ModelProfileScreen.tsx` — GDPR download section |
| Docs | `docs/GDPR_DELETE_FLOW.md`, `DATA_OWNERSHIP_MODEL.md`, `GDPR_REVOCATION.md`, `DATA_RETENTION_POLICY.md` |
| Edge | `delete-user/index.ts` — comment only |
| Meta | `CURSOR_GDPR_HARDENING_*.md/json` |
