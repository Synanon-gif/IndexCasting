# Invariant audit & regression map

**Purpose:** Continuous validation of canonical product rules (read-mostly diagnostics + tests).  
**Non-goals:** Architecture rewrites, automatic production data mutation.

**Dev utilities:** `src/utils/invariantValidationDev.ts` — pure validators + `logInvariantDev` / stable prefixes:

- `[roster][integrity]`
- `[calendar][dedupe]`
- `[chat][mat]`
- `[location][priority]` (reserved for future hooks)
- `[application][link]` (reserved)
- `[org][dissolve]` (reserved)

---

## Phase 1 — Coverage map by invariant

### 1. Location (live → current → agency → `models.city`)

| Layer | Enforcing / canonical read | Write path | Tests |
|-------|---------------------------|------------|-------|
| SQL / RPC | `get_discovery_models`, `get_models_near_location`, `get_models_by_location`, `get_guest_link_models` — `effective_city`, DISTINCT ON `model_locations` | `upsert_model_location`, agency saves | Near-me / discovery tests in repo; `model_locations` migrations |
| Frontend display | `canonicalDisplayCityForModel` (`src/utils/canonicalModelCity.ts`) | — | Implicit via screens |
| Dev drift hint | `validateLocationDisplayDriftHintDev` | — | `invariantValidationDev.test.ts` |

**Residual risk:** Legacy `getModelsPagedFromSupabase` still filters on `models.city` — documented as legacy; display should still use canonical helper.

---

### 2. Agency roster (MAT + relationship filter, not `models.agency_id` alone)

| Layer | Enforcing / read | Write | Tests |
|-------|------------------|-------|-------|
| Primary loader | `getModelsForAgencyFromSupabase` — MAT ids → `fetchAgencyRosterModelsByMatIds` + `modelEligibleForAgencyRoster` | `agency_remove_model`, MAT RPCs | `modelsSupabase` patterns; `removeModelFromAgency` test |
| Public roster | `get_public_agency_models` RPC — stricter (`active` + gate) | SQL migration `20260904_shadow_paths_canonical_guards.sql` | `publicAgencyProfileSupabase` |
| Dev | `devAssertAgencyRosterMatchesEligibility`, `validateRosterMatMembershipIssues` | — | `validateModelObjectDev.test.ts`, `invariantValidationDev.test.ts` |

**Shadow paths (intentional, not roster):** `.from('models')` in `optionRequestsSupabase`, `adminSupabase`, imports, GDPR, booking resolvers — see Phase 4.

---

### 3. Remove model (`agency_remove_model`)

| Layer | Enforcing | Tests |
|-------|-----------|-------|
| RPC | `agency_remove_model` (migrations `20260831`, `20260902`, …) | — |
| Client | `removeModelFromAgency` — requires `organizationId`, logs `[agency_remove_model]` | `modelsSupabase.removeModelFromAgency.test.ts` |
| Guard | `agency_update_model_full` rejects `ended` / removal misuse (`20260903`) | SQL comments |

**Invariant:** RPC `true` → roster reload must exclude model (MAT cleared server-side).

---

### 4. MAT / territory (`UNIQUE(model_id, country_code)`)

| Layer | Source | Tests |
|-------|--------|-------|
| DB | Constraint + territory RPCs | Migration history |
| UX rule | One agency relationship across multiple MAT rows — `validateAgencyAggregationDuplicatesDev` flags duplicate `(modelId, agencyId)` in a **displayed** list | `invariantValidationDev.test.ts` |

---

### 5. Calendar merge & dedupe

| Layer | Enforcing | Tests |
|-------|-----------|-------|
| Model calendar | `dedupeModelCalendarEntries` — `modelCalendarEntryBeats` (booking > option; non-cancelled > cancelled) | `modelCalendarSchedule.test.ts` |
| Dev | `logCalendarPreDedupeIfDuplicatesDev` on duplicate **active** rows sharing `option_request_id` | — |
| Agency unified | `buildUnifiedAgencyCalendarRows`, `dedupeUnifiedRowsByOptionRequest` | `agencyCalendarUnified` tests (if present) |
| Grid | `dedupeCalendarGridEventsByOptionRequest` | — |

**Canonical merge order (product doc):** `booking_events` → booking `calendar_entries` → option/casting `calendar_entries` → mirrored `user_calendar_events` → manual.  
Constants: `CALENDAR_CANONICAL_MERGE_ORDER` in `invariantValidationDev.ts` (documentation parity; agency merge uses layered dedupe in `agencyCalendarUnified.ts`).

**Residual risk:** ICS export / external feeds must be reviewed separately (`docs/CALENDAR_INTEROP_AUDIT_REPORT.md`).

---

### 6. Chat (Agency ↔ model, MAT)

| Layer | Enforcing | Tests |
|-------|-----------|-------|
| RPC | `ensure_agency_model_direct_conversation` — server MAT guard | — |
| Client | `ensureAgencyModelDirectChat`, `ensureAgencyModelDirectConversation`; `getOrCreateConversation` blocks `agency-model:` context | Manual / integration |
| Logs | `[chat][mat]` on RPC failure | — |

**Recruiting:** separate thread model (`recruiting_chat_*`) — not a substitute for MAT-gated direct chat.

---

### 7. Application → model

| Layer | Enforcing | Tests |
|-------|-----------|-------|
| RPC | `create_model_from_accepted_application` | `applicationsSupabase.recruiting.test.ts` |
| Store | `acceptApplication` — territories, agency id | `applicationsStore.test.ts` |

**Dev:** `[application][link]` reserved for future post-accept consistency checks (MAT + user_id).

---

### 8. Dissolve / delete

| Layer | Enforcing | Tests |
|-------|-----------|-------|
| Org dissolve | `dissolve_organization` RPC | `organizationsInvitationsSupabase.test.ts` |
| UI cache | `clearAgencyWorkspaceCachesAfterDissolve` → `resetB2bCachesAfterOrgDissolve` | — |
| Edge | `supabase/functions/delete-user` (auth + model `user_id` nulling, etc.) | Manual / security checklist |

**Note:** Dissolve ≠ full purge — copy in `uiCopy.accountDeletion`.

---

## Phase 2 — Automated checks (implemented)

| Check | Mechanism |
|-------|-----------|
| Roster row without MAT | `devAssertAgencyRosterMatchesEligibility` + dev warnings in `getModelsForAgencyFromSupabase` |
| Duplicate active `calendar_entries` per `option_request_id` | `logCalendarPreDedupeIfDuplicatesDev` inside `dedupeModelCalendarEntries` (dev only) |
| Duplicate agency row per model in UI list | `validateAgencyAggregationDuplicatesDev` (call from UI when aggregating, optional) |
| Location display drift hint | `validateLocationDisplayDriftHintDev` |
| Chat MAT failures | `[chat][mat]` error prefix |

---

## Phase 3 — Tests added / extended

- `src/utils/__tests__/invariantValidationDev.test.ts` — pure roster/calendar/aggregation/location helpers.
- Existing: `dedupeModelCalendarEntries`, `removeModelFromAgency`, `devAssertAgencyRosterMatchesEligibility` (messages updated to `[roster][integrity]`).

---

## Phase 4 — Shadow path inventory (`.from('models')` samples)

**Not exhaustive** — grep `src` for `.from('models')`. Classification:

| Area | File | Severity | Note |
|------|------|----------|------|
| Roster chunk fetch | `modelsSupabase` (`fetchAgencyRosterModelsByMatIds`) | **Low** | IDs pre-filtered via MAT |
| Single-model / discovery helpers | `modelsSupabase` (`getModelById`, paged legacy) | **Med** | Not roster; document legacy city filter |
| Client org assignments | `getModelsForOrganizationFromSupabase` | **Med** | `model_assignments` ids, not MAT |
| Option / booking resolvers | `optionRequestsSupabase` | **Low** | Resolver context |
| Admin / GDPR / import / sync | `adminSupabase`, `gdprComplianceSupabase`, imports, connectors | **Low–Med** | Operational, not “My Models” |

**Rule:** New **roster-like** features must use `getModelsForAgencyFromSupabase` or the same MAT+eligibility pipeline — not raw `agency_id` queries.

---

## Phase 5 — Residual risks & recommendations

1. **ICS / third-party calendar:** Explicitly test dedupe against app (see interop doc).
2. **Client dissolve:** Ensure `ClientWebApp` / native both call cache reset if multiple workspaces exist.
3. **Post-accept application:** Optional dev-only assert: MAT row + `user_id` after confirm (RPC-dependent).
4. **grep in CI:** Optional job: fail if new `getOrCreateConversation` usage with `agency-model:` context without RPC (pattern already blocked in code).

---

## Phase 6 — Fixes applied in this pass

- Added `invariantValidationDev.ts` + re-export barrel `validateModelObjectDev.ts`.
- `dedupeModelCalendarEntries` logs `[calendar][dedupe]` when multiple active rows share `option_request_id` (dev only).
- `getModelsForAgencyFromSupabase` dev warnings use `logInvariantDev` / `[roster][integrity]`.
- `ensureAgencyModelDirectChat` errors prefixed `[chat][mat]`.
- Linked this doc from `.cursor/rules/system-invariants.mdc` (CANONICAL DOMAIN TRUTH).

---

*Last updated: automated invariant checker introduction (repo).*
