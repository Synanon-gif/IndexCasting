# CURSOR — GDPR Hardening Phase 2 Report

## Scope completed

1. **`export_user_data` (Art. 15/20)** — Extended in [`supabase/migrations/20260511_gdpr_export_user_data_phase2.sql`](supabase/migrations/20260511_gdpr_export_user_data_phase2.sql): legal acceptances, received messages, conversations, recruiting threads/messages (scoped to user as creator/applicant/sender context), expanded option requests, calendar entries (model + option-request parties), notifications, activity logs, push tokens. Auth guard unchanged (`SECURITY DEFINER`, `row_security=off`, self or admin/super-admin). Audit via `log_audit_action` with `export_version: 2` in payload.

2. **Client layer** — [`src/services/dataExportService.ts`](src/services/dataExportService.ts): `formatExportPayload()` (camelCase + `domains` grouping), `downloadUserData()` for web JSON download. [`src/services/gdprComplianceSupabase.ts`](src/services/gdprComplianceSupabase.ts) delegates parsing and download.

3. **UI** — Model profile: “Download my data” in [`src/screens/ModelProfileScreen.tsx`](src/screens/ModelProfileScreen.tsx) (Agency + Client Web already had export).

4. **Documentation** — [`docs/GDPR_DELETE_FLOW.md`](docs/GDPR_DELETE_FLOW.md), [`docs/DATA_OWNERSHIP_MODEL.md`](docs/DATA_OWNERSHIP_MODEL.md), [`docs/GDPR_REVOCATION.md`](docs/GDPR_REVOCATION.md), [`docs/DATA_RETENTION_POLICY.md`](docs/DATA_RETENTION_POLICY.md).

5. **Delete-user** — Comment on `conversations.participant_ids` stale UUIDs after auth delete ([`supabase/functions/delete-user/index.ts`](supabase/functions/delete-user/index.ts)).

## Phase 6 — Privacy surface (checklist)

- **booking_details**: Remains UI-filtered; no claim of field-level RLS (see `BOOKING_BRIEF_SYSTEM.md`).
- **Guest flows**: No change; rely on existing RPCs and `revoke_guest_access`.
- **Debug**: No new production debug logging added; routine `console.error` on export failure only.

## Residual risks

- **`conversations.participant_ids`**: May retain deleted user UUIDs until a future cleanup migration (documented).
- **Export RPC**: Must stay subject-scoped; future tables need explicit predicates in `export_user_data` only.

## Validation

- `npm run typecheck`, `npm run lint`, `npm test -- --passWithNoTests --ci` — run after changes (see `CURSOR_GDPR_HARDENING_VERIFY.md`).
