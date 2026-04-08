# Contextual Chat Layers — Option/Casting + B2B

This document defines the current UX layering for chat context in IndexCasting.

## Scope

- Keep **two existing contexts** separate:
  - `Negotiation thread` (option/casting request specific)
  - `Org chat` (agency organization ↔ client organization)
- Add lightweight cross-navigation only.
- No auth, admin, paywall, RLS, or visibility changes.

## Canonical Context Anchors

- Negotiation thread: `option_request_id` (same as local `threadId` after reconciliation)
- Org chat: `conversation_id` (B2B conversation row)
- Org pair resolution: existing safe org relationships (`client_organization_id`, `agency_organization_id`) via existing services/RPCs

## UX Rules

1. The user must always understand which context is open.
2. A context switch is a navigation action, never a permission change.
3. No heuristic resolution (email matching, guess-by-name, fallback-to-first) for context linking.
4. If a stable ID is missing, hide the jump instead of guessing.

## Implemented Contextual Layers

- Request panel now shows an explicit negotiation context badge (`Negotiation thread`).
- Request panel exposes `Open org chat` to jump into the corresponding B2B org chat.
- Org chat panel carries `Org chat` context metadata in the thread header.
- Booking cards in org chat can expose `Open related request` when booking metadata contains `option_request_id`.

## Non-Goals (explicit)

- No merged chat timeline across contexts
- No new unread/read-receipt architecture
- No new chat platform or major chat-core refactor
- No security-layer behavior in Smart Attention or Assignment

## Compatibility Notes

- Smart Attention remains workflow-only (`status`, `final_status`, pricing/model-approval signals).
- Client assignment flags remain workflow metadata (`client_organization_id` keyed), not access control.
- Existing org-wide visibility remains unchanged.
