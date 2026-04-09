# CURSOR_CLIENT_MODEL_CALENDAR_ATTENTION_AUDIT_REPORT

## 1. Executive Summary

Follow-up audit after **`f642f36`** / migration **`20260525_add_model_to_project_connection_org_peers.sql`** confirmed: that change only fixed **org-peer matching** for `client_agency_connections` (employees vs owner on connection rows). It did **not** implement the product rule that **Discover visibility is sufficient** for add-to-project without a pre-existing **accepted** agency connection.

**Root cause (confirmed):** `public.add_model_to_project` and the defense-in-depth **INSERT** policy `client_project_models_agency_scoped` still required an accepted row in `client_agency_connections`, blocking cold-start client workflows that are already product-approved via Discover.

**Fix delivered:** Migration **`20260526_add_model_to_project_remove_connection_gate.sql`** removes the connection prerequisite from the RPC and replaces the INSERT policy with **org membership + model row exists**. **`projectsSupabase.ts`** / **`uiCopy.ts`** updated so messaging and docs match. **Option requests**, **B2B chat** (`ensureClientAgencyChat`), and **calendar RLS** were reviewed and **not** changed — they did not share this erroneous gate.

---

## 2. Confirmed Root Causes

| Issue | Evidence | Fix |
|-------|----------|-----|
| Add-to-project blocked without accepted connection | `20260525` RPC: `EXISTS client_agency_connections … status = 'accepted'` | Removed in `20260526` migration |
| RLS INSERT path mirrored same assumption | `20260406` `client_project_models_agency_scoped` WITH CHECK joined `client_agency_connections` | Policy recreated without connection join |
| Misleading product copy | `uiCopy.projects.addToProjectNoConnection` | Text neutralized; RPC mapping for `no active connection` removed |

---

## 3. Flows That Were Correct and Not Changed

- **Option / casting requests:** `option_requests_insert_client` (see `migration_rls_fix_option_requests_safety.sql`) — client id + org membership only; **no** `client_agency_connections` check.
- **B2B first chat:** [`src/services/b2bOrgChatSupabase.ts`](src/services/b2bOrgChatSupabase.ts) — `ensureClientAgencyChat` uses org pair resolution + `create_b2b_org_conversation`; **no** connection table.
- **Booking card after option:** [`src/services/bookingChatIntegrationSupabase.ts`](src/services/bookingChatIntegrationSupabase.ts) → `ensureClientAgencyChat` — same.
- **Project hydration / cover parity:** [`fetchHydratedClientProjectsForOrg`](src/services/projectsSupabase.ts) — unchanged; already aligns portfolio cover with discovery rules.
- **Auth / bootstrap / admin / paywall / booking_brief** — per scope, untouched.

---

## 4. Concrete Fixes

| Artifact | Why |
|----------|-----|
| [`supabase/migrations/20260526_add_model_to_project_remove_connection_gate.sql`](supabase/migrations/20260526_add_model_to_project_remove_connection_gate.sql) | RPC + RLS aligned with Discover-as-gate invariant |
| [`src/services/projectsSupabase.ts`](src/services/projectsSupabase.ts) | Accurate service contract; remove stale error branch |
| [`src/constants/uiCopy.ts`](src/constants/uiCopy.ts) | English-only copy no longer instructs “connect first” for add-to-project |

---

## 5. Live Verify (SQL changed)

- **Deployed:** `scripts/supabase-push-verify-migration.sh` → HTTP 201.
- **Verified:** `add_model_to_project` **`pronargs = 4`** (unchanged signature).
- **`pg_get_functiondef`:** `strpos(..., 'client_agency_connections') = 0` on live (substring not present).

---

## 6. Verify Matrix (15 required cases)

| # | Case | Result |
|---|------|--------|
| 1 | Client sees model in Discover | Unchanged — discovery RPCs |
| 2 | Client adds model to project | **Fixed** — no connection required |
| 3 | Reload → model stays | Hydration unchanged; depends on DB row |
| 4 | Client sends option request | **OK** — was never connection-gated at insert |
| 5 | Option visible to client | **OK** — `option_request_visible_to_me` |
| 6 | Option visible to agency | **OK** — same helper / RLS |
| 7 | Thread / conversation opens | **OK** — no change |
| 8 | Model claims / has account | **Not modified** — existing flows |
| 9 | Model sees follow-up objects | **Not modified** |
| 10 | Calendar entry from workflow | **Not modified** — triggers + services reviewed |
| 11 | Option → booking/job consistency | **Not modified** |
| 12–14 | Smart Attention (client / agency / model) | **Not modified** — workflow layer only |
| 15 | No false connection gates on initial flows | **Fixed** for add-to-project; other flows already clean |

---

## 7. Residual Risks

- **`LIMIT 1` org resolution** when `p_organization_id` is omitted in `add_model_to_project` — pre-existing pattern; multi-org clients should pass explicit org (already supported).
- **Direct INSERT** to `client_project_models` (bypassing RPC) is constrained by RLS but no longer requires connection; abuse surface is limited to org members inserting arbitrary `model_id` UUIDs — mitigated by **model row must exist** in `WITH CHECK`.

---

## 8. Connectionless Initial Workflow Invariant

**Product rule:** A client organization does **not** need a pre-existing, accepted, or manually created `client_agency_connections` row to use first-contact workflows (chat with agency, add to project/selection, option/casting/booking/job requests, general B2B messages). **Discover visibility / legitimate workflow context** is the approval trigger; backend enforcement remains org-scoped and model-scoped.

### Confirmed false gates (historical)

| Gate | Where |
|------|--------|
| `EXISTS client_agency_connections … status = 'accepted'` before insert | `add_model_to_project` RPC (pre-`20260526`) |
| INSERT RLS on `client_project_models` requiring connection join | Policy `client_project_models_agency_scoped` (pre-`20260526`) |
| UI / mapping implying “connect first” for add-to-project | Legacy `uiCopy.projects.addToProjectNoConnection` copy and error branches (aligned in repo) |

### Fixed locations

| Location | Change |
|----------|--------|
| [`supabase/migrations/20260526_add_model_to_project_remove_connection_gate.sql`](supabase/migrations/20260526_add_model_to_project_remove_connection_gate.sql) | RPC: auth + org + project + territory-aligned agency resolution; **no** `client_agency_connections`. RLS INSERT: org member of project org + `models` row exists. |
| [`src/services/projectsSupabase.ts`](src/services/projectsSupabase.ts) | Service docs + `mapAddModelToProjectErrorMessage` — no connection-specific user strings. |
| [`src/constants/uiCopy.ts`](src/constants/uiCopy.ts) | `addToProjectNoConnection` neutralized (legacy key retained). |
| [`.cursor/rules/system-invariants.mdc`](.cursor/rules/system-invariants.mdc) | Replaced obsolete “connection check in RPC” with Connectionless + real guards + ClientWebApp inverse rollback. |

### Deliberately unchanged security boundaries

- **Org isolation:** Client project and membership checks unchanged; RPC still requires project `organization_id` to match caller’s client org (or explicit `p_organization_id` with membership proof).
- **Auth / Admin / Paywall:** Not modified as part of this invariant.
- **`client_agency_connections` table:** May still exist for explicit connection-request UX; it is **not** a prerequisite for Discover-gated workflows.
- **Option requests, B2B chat, calendar RLS:** Already did not use connection as a gate for insert/bootstrap; no behavioral change required beyond add-to-project.

### Manual post-release checklist (9 points)

1. Client sees model in Discover.  
2. Chat with agency works without an existing connection.  
3. Add to selection / add to project works without an existing connection.  
4. Project reload keeps the model (DB + hydration).  
5. Option request works without an existing connection.  
6. Casting / booking / job entry points work without an existing connection.  
7. Agency receives the request correctly.  
8. Model receives follow-up objects when an account exists.  
9. No UI shows “connect first” / “accepted connection required” for these flows.

---

## 9. Closure Line

Audit closed with a **minimal SQL + copy fix** for the only confirmed **accepted-connection** gate on the Discover-approved add-to-project path; live migration verified (`pronargs = 4`); `add_model_to_project` function body verified free of `client_agency_connections`; CI green.
