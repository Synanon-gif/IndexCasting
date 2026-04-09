# CURSOR_FINAL_E2E_SMOKE_VERIFY

**Date:** 2026-04-09  
**Repo:** IndexCasting (path as on runner)

## Automated quality gates

Executed from project root:

```bash
npm run typecheck && npm run lint && npm test -- --passWithNoTests --ci
```

| Gate | Result |
|------|--------|
| `npm run typecheck` | PASS (exit 0) |
| `npm run lint` | PASS (exit 0) |
| `npm test -- --passWithNoTests --ci` | PASS — **80** suites, **894** tests |

## Playwright / browser E2E

- **Not run** in this pass. Existing suites under `e2e/` (`auth`, `guest-link`, `upload-consent`, `public-pages`) were not executed to save time; recommend optional `npx playwright test` when staging credentials are available.

## Manual staging checklist (recommended follow-up)

- [ ] Agency: add model with portfolio + optional polaroids + territory + agency location → reload list → open edit → data matches  
- [ ] Agency: add model with email → invite sent or explicit failure + manual link when applicable  
- [ ] Client: discover card images load (StorageImage); no polaroids in normal discover  
- [ ] Client: open polaroid package → polaroid images only  
- [ ] Model claim: complete flow after invite (separate session)  
- [ ] Near Me vs standard discover: note city source if `models.city` vs `model_locations` diverges on test data  

## Git

- Working tree clean except new `CURSOR_FINAL_E2E_SMOKE_*` files (see `git status` after add).
