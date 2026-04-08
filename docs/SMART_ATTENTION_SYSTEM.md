# Smart Attention System

## Goal

Smart Attention is an action-required layer for option/casting workflows.
It highlights where work is needed for Agency, Client, and Model without changing visibility or permissions.

## Product truth

- Org-wide visibility remains unchanged for all members.
- Client assignment remains workflow metadata, never security logic.
- Smart Attention is not unread/read-receipt logic.
- Attention is derived only from stable existing fields.

## Canonical source

- `src/utils/optionRequestAttention.ts`
  - `deriveSmartAttentionState()`
  - `smartAttentionVisibleForRole()`
  - `optionRequestNeedsMessagesTabAttention()`

All surfaces consume the same canonical derivation layer.

## Implemented attention states

- `no_attention`
- `waiting_for_client`
- `waiting_for_agency`
- `waiting_for_model`
- `counter_pending`
- `conflict_risk`
- `job_confirmation_pending`

## Derivation inputs

- `status`
- `final_status`
- `client_price_status`
- `model_approval`
- `model_account_linked`
- optional `hasConflictWarning` semantics

## Role relevance

- Agency: `waiting_for_agency`, `counter_pending`, `waiting_for_model`, `conflict_risk`
- Client: `waiting_for_client`, `job_confirmation_pending`
- Model: `waiting_for_model`

## UI surfaces

- `src/views/AgencyControllerView.tsx`
  - attention pill per thread
  - attention filter (`All attention` / `Action required only`)
- `src/web/ClientWebApp.tsx` (`MessagesView`)
  - attention pill per thread
  - attention filter (`All attention` / `Action required only`)
- `src/views/ModelView.tsx`
  - attention-driven inbox priority
  - explicit waiting-for-model action tag

## Explicit non-goals

- no auth/login/admin-path changes
- no RLS/policy changes
- no new DB columns
- no chat unread architecture
- no visibility gating by assignment or attention
