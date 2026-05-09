import { test } from './fixtures/base';

/**
 * P1 backlog — precise skip reasons (see docs/e2e-known-gaps.md).
 */

const BLOCKER_ROSTER =
  'BLOCKER (P1/selector-gap): My Models filter chips / roster search need stable aria-labels or data-testid and seed for filter outcome — implement without product changes not yet possible.';

const BLOCKER_TERRITORY =
  'BLOCKER (P1): Territory bulk modal touches multi-tenant rows; requires disposable seed org or explicit non-destructive modal smoke with empty selection — not implemented.';

const BLOCKER_GUEST =
  'BLOCKER (P1/env-gap): Set E2E_GUEST_LINK_TOKEN from isolated seed DB and verify guest package route; no committed token in repo.';

const BLOCKER_NEGOTIATION =
  'BLOCKER (P1): Counter-decline + agency-only job paths need dedicated seeded rows and destructive-free isolation — future specs must use write gates: E2E_ALLOW_OPTION_LIFECYCLE_MUTATIONS=I_UNDERSTAND, E2E_ALLOW_CHAT_WRITES=I_UNDERSTAND where applicable, and E2E_ALLOW_HOSTED_WRITES=I_UNDERSTAND_HOSTED_WRITE_RISK on hosted/non-local-dev base URLs; see .env.e2e.example.';

test.describe('P1 — My Models filters & roster search', () => {
  test('filter chips', async () => {
    test.skip(true, BLOCKER_ROSTER);
  });
});

test.describe('P1 — Territories bulk', () => {
  test('territory modal (non-destructive)', async () => {
    test.skip(true, BLOCKER_TERRITORY);
  });
});

test.describe('P1 — Guest link happy path', () => {
  test('valid token from E2E_GUEST_LINK_TOKEN', async () => {
    test.skip(true, BLOCKER_GUEST);
  });
});

test.describe('P1 — Counter-offer rejected & agency-only option', () => {
  test('negotiation edge cases', async () => {
    test.skip(true, BLOCKER_NEGOTIATION);
  });
});
