# UI Chat + Typography Pass — Diff Summary

## New files

- [`src/theme/chatLayout.ts`](src/theme/chatLayout.ts) — overlay width helpers, message scroll heights, thread list heights, `shouldUseB2BWebSplit`, flex constants for split layout.

## Modified files

- [`src/theme/theme.ts`](src/theme/theme.ts) — typography micro-scale + `body.fontWeight`.
- [`src/components/OrgMessengerInline.tsx`](src/components/OrgMessengerInline.tsx) — `useWindowDimensions`, dynamic message `maxHeight`, quick reply `fontSize` 12.
- [`src/views/BookingChatView.tsx`](src/views/BookingChatView.tsx) — dynamic card width and message scroll height.
- [`src/web/ClientWebApp.tsx`](src/web/ClientWebApp.tsx) — `Platform`, `useWindowDimensions`, B2B split layout, legacy `chatPanelMessages` max height from `chatLayout`, removed fixed `200` from stylesheet.
- [`src/views/AgencyControllerView.tsx`](src/views/AgencyControllerView.tsx) — agency B2B wide-web split; legacy option-request chat scroll height.
- [`src/screens/ModelProfileScreen.tsx`](src/screens/ModelProfileScreen.tsx) — option modal width + message scroll height.
- [`src/views/GuestChatView.tsx`](src/views/GuestChatView.tsx) — upgrade modal max width.

## Report / verify artifacts

- `CURSOR_UI_CHAT_TYPO_REPORT.md`, `CURSOR_UI_CHAT_TYPO_VERIFY.md`, `CURSOR_UI_CHAT_TYPO_PLAN.json`, this file.
