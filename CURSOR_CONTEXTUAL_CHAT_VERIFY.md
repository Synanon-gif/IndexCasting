# Contextual Chat Layers — Verify Checklist

## 1) User can tell active context

- [ ] Open agency/client messages and select an option request thread.
- [ ] Confirm `Negotiation thread` context badge is visible in request detail panel.
- [ ] Open an org chat conversation.
- [ ] Confirm org chat context is visible in the messenger subheader.

## 2) Open org chat works from request context

- [ ] In agency option request detail, click `Open org chat`.
- [ ] Verify Messages switches to B2B client-chat section and opens/activates the target conversation.
- [ ] In client option request detail, click `Open org chat`.
- [ ] Verify client Messages switches to B2B chats and opens/activates the target conversation.

## 3) Open related request works from org chat

- [ ] Submit a new option/casting request so booking card metadata includes `option_request_id`.
- [ ] Open the corresponding org chat booking card.
- [ ] Click `Open related request`.
- [ ] Verify UI switches to option request thread and loads that request detail.

## 4) Visibility and permissions unchanged

- [ ] Confirm users still only see data available before this change (org-wide behavior unchanged).
- [ ] Confirm no new role gate exists for context switches.

## 5) Smart Attention compatibility

- [ ] In option request lists, attention labels/filtering still behave unchanged.
- [ ] Contextual jumps do not alter attention state.

## 6) Assignment compatibility

- [ ] Existing assignment labels and member assignment controls still work.
- [ ] Contextual jumps do not change assignment metadata.

## 7) No Auth/Admin/Login/Paywall regression

- [ ] Smoke test login flows for existing roles.
- [ ] Confirm no changes in AuthContext/App routing behavior.
- [ ] Confirm paywall-dependent screens behave as before.

## 8) Static validation

- [ ] `npm run typecheck`
- [ ] `npm run lint`
- [ ] `npm test -- --passWithNoTests --ci`
