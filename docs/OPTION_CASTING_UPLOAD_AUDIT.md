# Option/Casting Upload Audit (Org Context)

## Scope
- Focus only on Option/Casting-related upload and audit behavior.
- No auth/admin/login/paywall changes.
- No RLS/RPC/trigger architecture changes.

## Relevant Upload Flows
- `src/services/optionRequestsSupabase.ts` -> `uploadOptionDocument`:
  - Storage bucket: `chat-files`
  - Path pattern: `options/{option_request_id}/{timestamp}_{sanitized_name}`
  - DB table: `option_documents`
- `addOptionMessage` in the same file is text-only (no file upload).

## Technical Pipeline (Option Documents)
1. `guardUploadSession` with `option-doc:{requestId}`
2. HEIC/HEIF conversion (`convertHeicToJpegWithStatus`)
3. MIME validation (`validateFile`, `CHAT_ALLOWED_MIME_TYPES`)
4. Magic bytes check (`checkMagicBytes`)
5. Extension consistency check (`checkExtensionConsistency`)
6. Filename sanitization (`sanitizeUploadBaseName`)
7. Storage quota guard (`checkAndIncrementStorage`)
8. Storage upload with explicit `contentType` and `upsert: false`
9. Insert metadata row into `option_documents`

## Org-Centric Audit Coupling
- After successful upload + `option_documents` insert, the service now resolves org context from `option_requests`:
  - `client_organization_id`
  - `organization_id` (legacy client org)
  - `agency_organization_id`
- Audit org resolution order:
  - `client_organization_id ?? organization_id ?? agency_organization_id`
- If present, it logs:
  - `logAction(orgId, 'uploadOptionDocument', { type: 'option', action: 'option_document_uploaded', ... }, { source: 'api' })`
- If org context is unavailable, upload still succeeds and a warning is emitted; no forced behavioral change.

## Explicit Non-Goals
- No new upload pipeline.
- No cross-flow logging rewrite.
- No migration.
- No changes to server-side option status/final_status/model_approval semantics.
