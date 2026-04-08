# Smart Attention Verify

## Core state checks

- [x] `waiting_for_client` is derived for client-action-required flows (`status`/`final_status` non-terminal and client-side continuation).
- [x] `waiting_for_agency` is derived for agency-action-required flows (`client_price_status = pending` in active negotiation paths).
- [x] `waiting_for_model` is derived when model approval is pending and model account is linked.
- [x] `conflict_risk` remains optional, semantics-safe, and based on existing conflict warning concept only.
- [x] `job_confirmation_pending` is derived from `final_status = option_confirmed` (action still required by client).

## UI / filter checks

- [x] Agency Messages option-request list shows Smart Attention pill.
- [x] Agency Messages supports `All attention` and `Action required only`.
- [x] Client Messages option-request list shows Smart Attention pill.
- [x] Client Messages supports `All attention` and `Action required only`.
- [x] Model inbox uses canonical attention for action highlighting and priority ordering.

## Assignment coupling checks

- [x] Assignment filters (`mine` / `unassigned` / flag / member) remain active and compatible with attention filtering.
- [x] Assignment is still keyed by `client_organization_id` and not dependent on chat existence.
- [x] Owner-only / no-booker workflow remains supported (no new dependency on booker presence).

## Safety / invariants checks

- [x] No visibility restriction introduced by attention or assignment.
- [x] No auth/admin/login path touched.
- [x] No paywall core logic touched.
- [x] No RLS/policy or migration wave introduced.

## Validation commands

- [x] `npm run typecheck`
- [x] `npm run lint`
- [x] `npm test -- --passWithNoTests --ci`
