# Contextual Chat Layers Report

## 1. Executive Summary

Contextual Chat Layers were implemented as a minimal UX/workflow enhancement on top of existing chat architecture.  
Option/Casting negotiation threads and B2B org chats remain separate, but users now get clearer context labels and safe quick jumps between them.

## 2. Which contexts are now clearer and better linked

- **Negotiation thread** remains request-specific (`option_request_id`).
- **Org chat** remains broader agency↔client relationship context (`conversation_id`).
- Both contexts are now surfaced with explicit context language and directional navigation actions.

## 3. Quick jumps / context hints added

- Added request-context badge (`Negotiation thread`) in request detail panels (agency + client message surfaces).
- Added `Open org chat` action from request detail (agency + client).
- Added org-chat context hint (`Org chat`) via `threadContext` in `OrgMessengerInline` usage.
- Added `Open related request` action on org-chat booking cards when `metadata.option_request_id` is present.

## 4. Smart Attention / Assignment compatibility

- Smart Attention logic remains untouched and workflow-derived only.
- Client Assignment remains `client_organization_id`-based workflow metadata.
- New navigation does not use assignment/attention as a security or visibility gate.

## 5. Rules decision

- No global rules were changed.
- Decision: this scope introduces UX-layer linking, not new global security invariants.
- Documentation was updated instead:
  - `docs/CONTEXTUAL_CHAT_LAYERS.md`
  - `docs/OPTION_CASTING_FLOW.md`

## 6. Why org-wide visibility remained unchanged

- All navigation uses existing safe IDs and existing services (`ensureClientAgencyChat`, `conversation_id`, `option_request_id`).
- No new query path or RLS condition was introduced.
- No visibility filters were modified.

## 7. Why auth/admin/login remained untouched

- No changes were made to AuthContext/login/bootstrap/admin routing or admin RPC guard functions.
- No paywall/auth-flow files were edited.

## 8. Next sensible step

Yes — **Booking Brief** is now a sensible next step, because contextual jumps are in place and can be extended to booking-brief surfaces without merging chat contexts.
