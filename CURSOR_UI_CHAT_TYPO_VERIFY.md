# UI Chat + Typography Pass — Verify Checklist

Use after deploy / local run.

- [ ] **B2B chat (client web)** opens substantially wider on desktop (split: chat column ~72% of row; stacked: full width below thread list).
- [ ] **Message history** in `OrgMessengerInline` is taller and more readable (web: ~50vh capped; native: ~380px).
- [ ] **Composer** remains usable (input row, send, attachments) in `OrgMessengerInline` and `BookingChatView`.
- [ ] **Recruiting / booking** `BookingChatView` card uses ~75% width (capped); message area scales with window height.
- [ ] **Agency Messages** B2B tab matches client split behavior on wide web.
- [ ] **Typography** slightly larger and slightly bolder globally (`theme.ts`); headings/labels/body still feel hierarchical.
- [ ] **No obvious overflow** on narrow mobile / small web widths (split disabled below 960px width).
- [ ] **Guest upgrade modal** respects new max width without breaking layout.

**Automated:** `npm run typecheck`, `npm run lint`, `npm test -- --passWithNoTests --ci` — all green after implementation.
