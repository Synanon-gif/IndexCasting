# UI Chat + Typography Pass — Report

## 1. Executive Summary

This pass improves **chat workspace readability** (wider overlays, taller message history, optional **~72/28** thread|chat split on wide web) and applies a **small global typography scale** (~+1px per tier, `body` `fontWeight: '500'`) in [`src/theme/theme.ts`](src/theme/theme.ts). Central layout tokens live in [`src/theme/chatLayout.ts`](src/theme/chatLayout.ts). No auth, paywall, routing, or backend logic was changed.

## 2. Chat width / layout changes

| Area | Change |
|------|--------|
| [`OrgMessengerInline`](src/components/OrgMessengerInline.tsx) | Message `ScrollView` uses `getMessagesScrollMaxHeight(windowHeight)` instead of fixed `220`. |
| [`BookingChatView`](src/views/BookingChatView.tsx) | Card `maxWidth` uses `getChatOverlayMaxWidth(windowWidth)` (~75% capped at 1024px). Message area height uses `getMessagesScrollMaxHeight`. |
| [`ClientWebApp` `ClientB2BChatsPanel`](src/web/ClientWebApp.tsx) | Web + width ≥960: row split (`CHAT_THREAD_LIST_FLEX` / `CHAT_MESSENGER_FLEX`). Thread list uses `getThreadListMaxHeight` / `getThreadListMaxHeightSplit`. |
| [`AgencyControllerView` `AgencyMessagesTab`](src/views/AgencyControllerView.tsx) | Same split pattern for **B2B client requests** on wide web. Legacy option-request message `ScrollView` uses `getLegacyChatPanelMessagesMaxHeight`. |
| [`ModelProfileScreen`](src/screens/ModelProfileScreen.tsx) | Option chat modal: dynamic overlay width + message scroll height from `chatLayout`. |
| [`GuestChatView`](src/views/GuestChatView.tsx) | Upgrade modal width aligned with `getChatOverlayMaxWidth`. |

## 3. Typography scaling

- [`src/theme/theme.ts`](src/theme/theme.ts): `heading` 24→25, `body` 14/20→15/22 + `fontWeight: '500'`, `label` 11→12. Relative steps (heading > body > label) preserved.
- Quick reply chips in `OrgMessengerInline`: 11→12 for alignment with scaled label tier.

## 4. Surfaces checked (recommended manual pass)

Dashboard, My Models, Clients, Messages, Calendar, Recruiting, Team, Links, Settings, Guest/Shared, Auth/Paywall/Billing/Legal — **code not touched** for business logic; visual QA recommended on web + native narrow widths.

## 5. Why hierarchy stayed intact

Single proportional bump on the three shared tokens; explicit `fontSize` overrides elsewhere unchanged unless they would fight the new defaults (only quick-reply tweak in messenger). No new text roles or semantic levels added.

## 6. Manual review suggested

- Wide web: B2B split row — confirm thread column scroll and messenger column don’t clip on small laptop heights.
- Native: confirm `OrgMessengerInline` message area height (~380px cap) feels acceptable on phones.
- Inter `fontWeight: '500'` on web vs fallback fonts.
