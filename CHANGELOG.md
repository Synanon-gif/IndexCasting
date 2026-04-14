# Changelog

All notable changes to this project will be documented in this file.

---

## [post-hardening-baseline-2026-04] — 2026-04-14

**Tag:** `post-hardening-baseline-2026-04`
**Commit:** `7675a3a` on `main`
**Migrations:** 208 total (`20260404` – `20260818`)

This release marks the completion of the initial hardening phase. It is a
documentation-only baseline — no product behavior was changed at tagging time.

### Security hardening

- **Admin triple-layer detection:** UUID + email pinned `get_own_admin_flags()`,
  `is_current_user_admin()`, and `role === 'admin'` fallback — all three must fail
  simultaneously to lock out admin.
- **RLS recursion elimination (42P17):** FOR ALL policies on `model_embeddings`,
  `model_locations`, `model_agency_territories`, `calendar_entries`,
  `model_minor_consent` split into per-operation policies. Self-referencing policy
  regression on `clients_view_model_territories` fixed and anti-regression rule added.
- **SECURITY DEFINER hardening:** All policy-called SECDEF functions carry
  `SET row_security TO off`. Internal 3-layer auth guards (auth.uid, membership,
  resource ownership) mandatory for every `row_security=off` RPC.
- **Storage policy isolation:** `documentspictures` bucket policies use SECDEF
  helpers (`can_agency_manage_model_photo`, `can_view_model_photo_storage`) instead
  of direct `models`/`profiles` joins — decouples storage from models-RLS state.
- **Email-based auth eliminated from RLS:** No policy uses email matching; all
  org-scoped via `organization_members` + `org_id`.
- **Model claim tokens:** `link_model_by_email` deprecated; token-based
  `generate_model_claim_token` / `claim_model_by_token` canonical.
- **SECDEF RPCs:** email-auth replaced with org-membership guards
  (`20260719`). Admin RPCs unified under `assert_is_admin()` (`20260720`).
- **Shared selection HMAC token** (`20260810`).
- **Recruiting messages insert policy** scoped (`20260809`).
- **Application photos agency-scoped** (`20260812`).
- **Documents & chat-files bucket policies** hardened (`20260815`, `20260816`).
- **GDPR retention orchestrator** migration (`20260813`).
- **Polaroid discovery restriction** canonicalized (`20260817`).

### Workflow / lifecycle fixes

- **Two-axis separation (K):** Price negotiation (Axis 1) and availability
  confirmation (Axis 2) fully decoupled — no handler mutates both axes
  (exception: terminal `client_confirm_option_job`).
- **Agency-only option/casting flow:** Complete lifecycle including calendar
  triggers, `model_approval` branching, INSERT+UPDATE pattern for AFTER UPDATE
  triggers, `created_by_agency` flag, price-UI suppression.
- **Model confirmation gate:** 4-condition canonical gate (account linked, pending
  approval, agency confirmed, in_negotiation). Agency availability must precede
  model confirmation.
- **Non-retroactive model approval (E-0):** Account linking after
  availability-cleared lifecycle does not re-require model action.
- **Option status transition trigger** (`fn_validate_option_status_transition`)
  formalized in migrations (`20260711`).
- **Rejection cascade:** `fn_reset_final_status_on_rejection` + calendar
  cancellation trigger (`fn_cancel_calendar_on_option_rejected`).
- **Delete parity:** `delete_option_request_full` atomic RPC for pre-job removal.
- **Client decline counter-offer:** Axis-1-only, fail-closed, no `final_status`
  guard (`20260614`).
- **B2B conversation org-pair invariant** enforced (`20260716`).
- **Invite-before-bootstrap invariant:** 3-layer zombie-org prevention for invited
  bookers/employees (`20260818`).
- **Atomic agency counter-offer** (`20260818`).

### Smart Attention system

- Canonical derivation pipeline: `attentionSignalsFromOptionRequestLike` →
  `deriveNegotiationAttention` (D1) + `deriveApprovalAttention` (D2) →
  `attentionHeaderLabelFromSignals`.
- All call-sites carry `isAgencyOnly` flag.
- Messages-tab-dot derives from same pipeline as thread headers.
- Calendar badges, grid colors, and next-step text aligned with pipeline.
- No parallel heuristics allowed.

### Frontend / navigation / UX

- **Full responsive audit:** Mobile-first WhatsApp-like chat, compact headers,
  full-width screens, bottom-tab-bar hidden in chat workspaces.
- **Calendar strict view isolation:** Month/week/day mutually exclusive rendering.
  Lifecycle dedup (no duplicate option+job entries). Semantic colors canonical.
- **Gallery / detail presentation:** Projects, packages, shared links with
  consistent grid and detail overlay.
- **PDF export:** Web-only, scope-limited, dynamic `jspdf` import.
- **Discovery image normalization:** `normalizeDocumentspicturesModelImageRef` +
  `StorageImage` pipeline. No raw `supabase-storage://` or naked filenames.
- **Canonical city display:** `effective_city` → `model_locations.city` → `models.city`
  priority chain via `canonicalDisplayCityForModel()`.
- **Measurement display:** "Chest (cm)" — never "Bust" in user-facing UI.

### Media / upload / storage

- **Upload technical parity:** MIME allowlist, magic bytes, extension consistency,
  HEIC pipeline, `upsert: false`, sanitized filenames across all upload paths.
- **EXIF stripping** for uploaded images.
- **Polaroid enforcement:** Polaroids only in packages/guest links, never in
  discovery.
- **Storage negative cache + dedup + canonical resolution** hardened.
- **Client model photo visibility alignment:** `model_photos` RLS and
  `can_view_model_photo_storage` consistency (`20260814`).

### Scalability / performance

- **Discovery RPC optimization** (`20260801`).
- **Option requests RLS dedup** (`20260802`).
- **Near Me bbox-before-distinct** (`20260803`).
- **Calendar entries RLS SECDEF helper** (`20260804`).
- **Missing indexes** added (`20260805`).
- **Keyset pagination for location** (`20260806`).
- **Option request advisory lock** (`20260807`).
- **18 optimizations** for 50k-model load documented in scalability audit commit.

### Realtime / notifications

- `subscribeToOptionMessages` and `subscribeToThreadMessages` wired in all
  thread views.
- System messages via `insert_option_request_system_message` SECDEF RPC with
  `from_role = 'system'`.
- Notification resolver uses `agency_organization_id` from option request row
  (preferred) with org-lookup fallback.

### Documentation

- 48 documentation files in `docs/` covering audit reports, security summaries,
  verification matrices, system design, and compliance checklists.
- Cursor rules (`.cursor/rules/`) formalize 11+ rule files covering admin
  security, RLS patterns, system invariants, auto-review, agency-only flows,
  option-request hardening, upload consent, dev workflow, and more.

### Known remaining caveats

- `link_model_by_email` still called in legacy `signIn`/`signUp` fallback path
  (deprecated, isolated in try-catch, to be removed after full token migration).
- Multi-org UI switching not yet implemented; oldest membership used
  deterministically with warning log.
- `getModelsPagedFromSupabase` (swipe legacy) still uses `models.city` directly
  (to be replaced by ranked discovery).
- Data retention windows defined but automated enforcement partially staged.
- Stripe live go-live checklist exists but sandbox-to-live cutover not yet
  executed.
