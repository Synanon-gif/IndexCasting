# Semantic UX Consistency Matrix — Model Lifecycle × UI Surface

**Audit Companion:** [FULL_SYSTEM_AUDIT_2026-04-17.md](./FULL_SYSTEM_AUDIT_2026-04-17.md) (Gap 4)
**Test Companion:** [`src/services/__tests__/crossFlowAndRaceInvariants.test.ts`](../src/services/__tests__/crossFlowAndRaceInvariants.test.ts)
**Date:** 2026-04-17
**Scope:** Verifies that **every UI surface** renders **the same logical truth** for **every Model lifecycle state**.

---

## Why this matrix exists

The 1h-Audit identified four blind spots beyond the per-area sweep:

1. Cross-Flow Interactions
2. State Race Conditions
3. Multi-Actor Synchronisation
4. **Semantic UX Consistency** ← this document

The fix-paths from prior hardening are correct, but **UX divergence between surfaces** can still erode user trust (e.g. recruiting bucket says "represented" while roster says "ended"). This matrix maps the **canonical truth** for each lifecycle state to the rendering rule on each surface.

**Authoritative invariant (NEVER violate):** A model's representation status is derived from `model_agency_territories` (MAT). All surfaces below MUST agree: a model is "represented by Agency X" iff a non-soft-deleted MAT row exists for `(model_id, country_code, X)`. The application lifecycle (`pending` → `pending_model_confirmation` → `accepted` → `representation_ended`) is **historical/audit metadata** — it is NOT the visibility truth.

---

## Lifecycle States (rows)

| Code | State | DB markers |
|---|---|---|
| **L0** | `pending` (no decision yet) | `model_applications.status='pending'` |
| **L1** | `pending_model_confirmation` (agency accepted, model has not confirmed) | `model_applications.status='pending_model_confirmation'`, `accepted_by_agency_id IS NOT NULL` |
| **L2** | `accepted` + active MAT (fully represented) | `model_applications.status='accepted'` AND MAT row exists |
| **L3** | `accepted` + no MAT (stale ghost — diagnostic) | `model_applications.status='accepted'` AND no MAT row → triggers `STALE_PENDING_MODEL_CONFIRMATION_NO_MAT` |
| **L4** | `representation_ended` (was represented, agency removed) | `model_applications.status='representation_ended'`, MAT row removed |
| **L5** | `rejected` (agency declined or model declined accept) | `model_applications.status='rejected'` |

---

## UI Surfaces (columns)

| Code | Surface | File / Function |
|---|---|---|
| **S1** | Agency Recruiting buckets | `src/views/AgencyRecruitingView.tsx` |
| **S2** | Agency Roster (My Models) | `src/views/AgencyControllerView.tsx` |
| **S3** | Agency ↔ Model direct chat (auto-ensure) | `ensureAgencyModelDirectConversation` in `src/services/b2bOrgChatSupabase.ts` |
| **S4** | Recruiting chat thread | `src/views/BookingChatView.tsx` (active_model vs recruiting) |
| **S5** | Model side: own application card | `src/views/ModelApplicationsView.tsx` |
| **S6** | Client Discover (territory match) | `get_discovery_models` RPC + `src/screens/ClientWebApp.tsx` |

---

## Canonical Matrix (5 × 6 = 30 cells)

| | **S1 Recruiting** | **S2 Roster** | **S3 Direct Chat** | **S4 Recruiting Thread** | **S5 Model Apps** | **S6 Client Discover** |
|---|---|---|---|---|---|---|
| **L0 pending** | Bucket: **Pending** | Hidden | NOT auto-created (MAT absent) | `chat_type=recruiting`, "Pending decision" | "Pending — agency reviewing" | Hidden (no MAT) |
| **L1 pending_model_confirmation** | Bucket: **Confirm** (waiting for model) | Hidden (still no MAT) | NOT auto-created (MAT only created on `accepted`) | `chat_type=recruiting`, "Awaiting model confirmation" | **Action required:** Confirm / Decline | Hidden (no MAT) |
| **L2 accepted + MAT** | Bucket: **Accepted** (history) | Visible row, "Active" | Auto-created on first surface mount | `chat_type=active_model` | "Represented by {agency}" | Visible in matched territories |
| **L3 accepted, no MAT (ghost)** | **DIAGNOSTIC** — must not normally appear; logged via `logInvariantDev('[recruiting][integrity]', ...)` | Hidden | Returns `null` (`no_active_representation` MAT gate) | UI shows "Connection ended" if thread exists | "Represented" badge could mislead — fixed by `attachApplicantModelIdsAndMatFlags` to render "Connection inactive" | Hidden |
| **L4 representation_ended** | Bucket: **Ended** (read-only history) | Hidden | Returns `null` (MAT gate) | `chat_type` may stay `active_model` historically; UI shows "Representation ended" banner | "Ended — you can re-apply" + Re-apply button | Hidden |
| **L5 rejected** | Bucket: **Rejected** (read-only) | Hidden | NOT auto-created | recruiting thread persists for audit; no new messages | "Application not selected — re-apply allowed" | Hidden |

---

## Per-Cell Verification Notes

### L1 × S1 (`Confirm` bucket)
The bucket name **MUST** be model-perspective neutral ("Awaiting confirmation"), not agency-claim ("Accepted"). Code reference: `AgencyRecruitingView.tsx` filters by `status === 'pending_model_confirmation'` for the Confirm bucket.

### L1 × S5 (Model side)
The model's own card must show **action-required** affordance with two buttons: Confirm + Decline. Both must call `confirmApplicationByModel` / `rejectApplicationByModel` (store layer with cache update + notify). Source: `applicationsStore.ts` Z.365 / Z.400.

### L2 × S3 (Direct chat auto-create)
First UI surface that mounts a thread for an L2 pair calls `ensureAgencyModelDirectConversationWithRetry`. The session cache (`clearSessionEnsuredAgencyModelDirectChats` exposed for logout/refresh) deduplicates parallel mount calls — verified by [crossFlowAndRaceInvariants.test.ts](../src/services/__tests__/crossFlowAndRaceInvariants.test.ts) Invariants I-5/I-6.

### L3 × S1 (Ghost diagnostic)
This combination should never persist in normal operation — the migration `20260916_backfill_ghost_accepted_applications.sql` cleared historical ghosts. New ghosts are detected by `STALE_PENDING_MODEL_CONFIRMATION_NO_MAT` and surfaced in dev logs. **UI must NOT render "Represented" badge based on `application.status` alone** — it must verify MAT presence via `hasActiveMat` flag attached by `attachApplicantModelIdsAndMatFlags`.

### L4 × S3 / S4 (post-removal chat continuity)
After agency removes a model, a **new** application + accept restores the same `context_id` (agency-model pair) → ensure-RPC returns the **same conversation_id** → message history is preserved. Verified by [crossFlowAndRaceInvariants.test.ts](../src/services/__tests__/crossFlowAndRaceInvariants.test.ts) Invariant I-4 ("Cross-Flow Sequenz").

### L4 × S5 (Re-apply)
The model's application card in `representation_ended` state MUST surface the "Re-apply" affordance (not be a dead-end). Re-apply creates a new `model_applications` row with `status='pending'` → cycle restarts at L0. The previous application row remains as `representation_ended` history.

### L5 × S4 (Rejected thread persistence)
Recruiting threads persist for audit (no DELETE), but the agency cannot send new messages. UI must render the thread in read-only mode with "Application closed" banner.

---

## Defense-in-Depth Surfaces (already enforced)

These cells are protected at multiple layers (DB + service + UI) and do not depend on UI consistency alone:

| Concern | DB Layer | Service Layer | UI Layer |
|---|---|---|---|
| Discover visibility | `get_discovery_models` filters by MAT + visibility flags | n/a | client-side |
| Direct chat creation | `ensure_agency_model_direct_conversation` RPC enforces MAT | `ensureAgencyModelDirectConversation` returns null on `no_active_representation` | UI hides "open chat" if null |
| Application status mutation | `.eq('status', requiredPrior)` optimistic concurrency | `updateApplicationStatus` returns false on race | Toast / silent failure recovery |
| MAT uniqueness | `UNIQUE (model_id, country_code)` constraint | `save_model_territories` ON CONFLICT (model_id, country_code) | n/a |

---

## Surfaces Out of Scope (not part of this matrix)

- **Calendar surfaces** — covered in `CALENDAR_INTEROP_AUDIT_REPORT.md` and `system-invariants.mdc` ("calendar dedupe")
- **Option / Casting / Job lifecycle** — covered in `OPTION_NEGOTIATION_*.md` and `option-requests-chat-hardening.mdc`
- **Paywall / billing visibility** — covered in `PAYWALL_SECURITY_SUMMARY.md`

---

## Regression Guard

Any change to these files MUST re-verify each affected matrix cell:

- `src/views/AgencyRecruitingView.tsx`
- `src/views/AgencyControllerView.tsx`
- `src/views/ModelApplicationsView.tsx`
- `src/views/BookingChatView.tsx`
- `src/services/b2bOrgChatSupabase.ts`
- `src/services/applicationsSupabase.ts`
- `src/store/applicationsStore.ts`
- `get_discovery_models` SQL function
- `ensure_agency_model_direct_conversation` SQL function

**Rule:** If a UI surface starts deriving "represented" / "active" from anything other than MAT (e.g. `application.status` alone), STOP and re-add the MAT verification. The application row is **history**; MAT is **truth**.

---

## Status

All 30 cells pass canonical truth alignment. No UX divergence detected in this audit pass.
