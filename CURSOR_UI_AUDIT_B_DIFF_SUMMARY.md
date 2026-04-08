# UI Audit B — Diff Summary

## Changed files

| File | Purpose |
|------|---------|
| [`src/constants/uiCopy.ts`](src/constants/uiCopy.ts) | Agency model edit + swipe measurement labels: explicit **cm** units and **Chest / Bust** wording consistency. |
| [`src/web/ClientWebApp.tsx`](src/web/ClientWebApp.tsx) | Discover + package-grid cover overlays: **Chest** with `chest \|\| bust` fallback; **cm** on height/waist/hips/inseam for client-visible cards. |
| [`src/views/GuestView.tsx`](src/views/GuestView.tsx) | Guest package UI: **Chest** label + **cm** on measurement line (value still from `bust` field returned by guest RPC). |
| [`src/views/SharedSelectionView.tsx`](src/views/SharedSelectionView.tsx) | Shared URL selection: measurement line shows **Chest** + **cm** (data still uses `measurements.bust` from summary). |

## Risk

- **Low:** Copy and display-only formatting; no API, RLS, or auth changes.
- **Regression:** None expected; agency save path unchanged (still mirrors chest/bust server-side from existing code).

## Test linkage

- `npm run typecheck` — pass  
- `npm run lint` — pass  
- `npm test -- --passWithNoTests --ci` — pass  

No new unit tests added (string-only UX alignment; existing tests unaffected).
