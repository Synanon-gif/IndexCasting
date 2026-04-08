# Smart Attention Report

## 1) Executive Summary

The Smart Attention System has been implemented as a small, canonical action-required layer on top of existing option/casting workflow data.
It improves operational clarity for Agency, Client, and Model without changing access control or visibility.

## 2) Implemented attention states

- `no_attention`
- `waiting_for_client`
- `waiting_for_agency`
- `waiting_for_model`
- `counter_pending`
- `conflict_risk`
- `job_confirmation_pending`

## 3) How states are derived

Canonical derivation is implemented in `src/utils/optionRequestAttention.ts`:

- Inputs: `status`, `final_status`, `client_price_status`, `model_approval`, `model_account_linked`, optional conflict warning semantics.
- Role visibility guard: `smartAttentionVisibleForRole(state, role)`.
- Existing display-status semantics (`toDisplayStatus`) remain respected for terminal mapping.

## 4) Where Smart Attention is surfaced

- `src/views/AgencyControllerView.tsx`
  - Attention pill in option-request rows.
  - Attention filter: `All attention` / `Action required only`.
- `src/web/ClientWebApp.tsx` (`MessagesView`)
  - Attention pill in option-request rows.
  - Attention filter: `All attention` / `Action required only`.
- `src/views/ModelView.tsx`
  - Inbox priority and highlight use canonical smart-attention derivation.

## 5) Assignment integration

- Existing assignment metadata (`assigned_member_user_id`, flag, mine/unassigned/member filters) stays intact.
- Attention and assignment combine in filtering/prioritization only.
- No assignment-based data hiding was introduced.

## 6) Rules decision

Confirmed as global guardrails and added additively:

- `.cursorrules`
- `.cursor/rules/system-invariants.mdc`
- `.cursor/rules/auto-review.mdc`

Added principles:

- Assignment is workflow metadata, never security.
- Smart attention is action-required, not unread/security.
- Attention derives only from stable existing workflow fields.
- Attention/assignment must not alter visibility or permissioning.

## 7) Why org-wide visibility is unchanged

No query scope, RLS policy, or permission checks were changed.
All org members keep the same visibility; attention only changes visual prioritization and filtering.

## 8) Why Auth/Admin/Login stayed untouched

No changes were made to:

- `AuthContext` login/bootstrap paths
- `App.tsx` admin routing
- admin guard RPC stack (`get_own_admin_flags`, `is_current_user_admin`, `assert_is_admin`)
- paywall core flow

## 9) Next sensible step

**Contextual Chat Layers** is the better next step before a Booking Brief, because Smart Attention is now in place and can be used to drive context-aware thread UX without changing backend security boundaries.
