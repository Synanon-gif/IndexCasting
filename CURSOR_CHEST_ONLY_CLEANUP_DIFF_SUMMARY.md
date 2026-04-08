# Chest-only cleanup — diff summary

| File | Purpose | Risk |
|------|---------|------|
| [`src/constants/uiCopy.ts`](src/constants/uiCopy.ts) | Chest-only labels; `swipe.measurementChest` replaces `measurementBust`; filter section wording | Low — copy only |
| [`src/screens/CustomerSwipeScreen.tsx`](src/screens/CustomerSwipeScreen.tsx) | `ClientModel.chest` = `chest ?? bust`; swipe UI uses `measurementChest` | Low — display mapping |
| [`src/screens/ModelProfileScreen.tsx`](src/screens/ModelProfileScreen.tsx) | Model self profile: `chest` state + `uiCopy.modelEdit` measurement labels | Low |
| [`src/utils/modelCompleteness.ts`](src/utils/modelCompleteness.ts) | Agency completeness banner text; comment on legacy `bust` | Low |
| [`src/web/ClientWebApp.tsx`](src/web/ClientWebApp.tsx) | Project overview measurement line: explicit `cm` for chest/waist/hips | Low |
| [`e2e/guest-link.spec.ts`](e2e/guest-link.spec.ts) | Negative tests use `chest` instead of `bust` string | Low — test heuristic only |
| [`.cursor/rules/auto-review.mdc`](.cursor/rules/auto-review.mdc) | Guardrails for future UI copy | None — process |

## Test linkage

- `npm run typecheck`, `npm run lint`, `npm test -- --passWithNoTests --ci`
- Playwright: `e2e/guest-link.spec.ts` (if run in CI)

## Auth / admin / paywall

Unchanged — no edits to AuthContext, admin RPCs, paywall, or calendar RLS.
