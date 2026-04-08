/**
 * Optional UI flag: set EXPO_PUBLIC_STRIPE_SANDBOX=1 in .env.local / Vercel
 * when Stripe is in test mode so the app can show a clear test-mode notice.
 */
export function isStripeSandboxUiEnabled(): boolean {
  if (typeof process === 'undefined') return false;
  const v = process.env?.EXPO_PUBLIC_STRIPE_SANDBOX;
  return v === '1' || v === 'true';
}
