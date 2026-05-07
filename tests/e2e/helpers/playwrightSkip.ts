import { test } from '../fixtures/base';
import {
  credentialGapMessage,
  emailForRole,
  hasAuthCredentials,
  loadSeedManifestIfAvailable,
  type E2EAccountRole,
} from './env';

/** Skip with an explicit reason (no silent pass). Uses extended test fixture for diagnostics. */
export function skipWithReason(reason: string): void {
  test.skip(true, reason);
}

/** Skips when no shared password is configured (emails have seed defaults). */
export function requireE2ECredentials(_role?: E2EAccountRole): void {
  void _role;
  if (!hasAuthCredentials()) {
    skipWithReason(credentialGapMessage());
  }
}

/**
 * Requires password + non-empty resolved email for the role. Does not silently skip when password exists.
 */
export function requireRoleAccount(role: E2EAccountRole): void {
  if (!hasAuthCredentials()) {
    skipWithReason(credentialGapMessage());
    return;
  }
  const email = emailForRole(role);
  if (!email?.includes('@')) {
    skipWithReason(`Invalid or empty email for role "${role}" — set E2E_*_EMAIL in .env.e2e if overriding defaults.`);
  }
}

/** Skip when local seed manifest is absent (gitignored; produced by `npm run seed:e2e`). */
export function skipIfNoManifest(reason: string): void {
  if (!loadSeedManifestIfAvailable()) {
    skipWithReason(
      `${reason} Required file missing: docs/e2e-seed-manifest.json (run npm run seed:e2e on isolated DB; file is not committed).`,
    );
  }
}

/** Alias: fail-closed skip when manifest rows needed. */
export function requireSeedManifest(reason = 'This test requires seeded UUIDs from the manifest.'): void {
  skipIfNoManifest(reason);
}
