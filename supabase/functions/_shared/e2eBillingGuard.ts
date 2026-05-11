/**
 * E2E billing safety — optional server-side block for external billing side effects.
 *
 * Set Supabase Edge secret:
 *   E2E_BILLING_NO_EXTERNAL_SIDE_EFFECTS=I_UNDERSTAND
 * to block Checkout, Stripe invoice send, Resend e-mail send, and Stripe subscription cancel
 * in this project — without changing default behavior when unset.
 *
 * Optional belt-and-suspenders (Stripe API calls only):
 *   E2E_STRIPE_LIVE_EXTERNAL_BLOCK=I_UNDERSTAND
 * When STRIPE_SECRET_KEY is recognisably live (sk_live_…), block those Stripe calls
 * even if the main latch above is not set. Does not block Resend.
 *
 * Never log secret values or customer PII here.
 */

export const E2E_BILLING_LATCH_OK = 'I_UNDERSTAND';

export const E2E_BILLING_BLOCK_CODE = 'e2e_billing_external_side_effect_blocked';

const BLOCK_MESSAGE =
  'Billing actions that contact external payment or e-mail providers are disabled in this environment (E2E safety).';

export function isE2eBillingNoExternalSideEffectsEnabled(): boolean {
  return Deno.env.get('E2E_BILLING_NO_EXTERNAL_SIDE_EFFECTS')?.trim() === E2E_BILLING_LATCH_OK;
}

/** Optional: block Stripe mutating Edge paths when the configured key is live. */
export function isE2eStrictLiveStripeExternalBlockEnabled(): boolean {
  return Deno.env.get('E2E_STRIPE_LIVE_EXTERNAL_BLOCK')?.trim() === E2E_BILLING_LATCH_OK;
}

export type StripeKeyMode = 'live' | 'test' | 'unknown';

/** Derive Stripe mode from secret prefix only — never log the key. */
export function getStripeKeyModeFromEnv(): StripeKeyMode {
  const k = Deno.env.get('STRIPE_SECRET_KEY')?.trim() ?? '';
  if (k.startsWith('sk_live_')) return 'live';
  if (k.startsWith('sk_test_')) return 'test';
  return 'unknown';
}

export function e2eBillingExternalBlockPayload(): Record<string, unknown> {
  return {
    ok: false,
    blocked: true,
    code: E2E_BILLING_BLOCK_CODE,
    error: BLOCK_MESSAGE,
    message: BLOCK_MESSAGE,
  };
}

export type E2eBillingHttpClientHint = 'fetch' | 'invoke';

/**
 * @param scope `stripe` — main latch OR strict-live latch; `resend` — main latch only (e-mail).
 */
export function maybeE2eBillingExternalBlockResponse(
  cors: Record<string, string>,
  functionLabel: string,
  clientHint: E2eBillingHttpClientHint,
  scope: 'stripe' | 'resend',
): Response | null {
  const stripeMode = getStripeKeyModeFromEnv();
  const main = isE2eBillingNoExternalSideEffectsEnabled();
  const strictLive =
    scope === 'stripe' && isE2eStrictLiveStripeExternalBlockEnabled() && stripeMode === 'live';

  if (!main && !strictLive) return null;

  const reason = main ? 'main_latch' : 'strict_live_stripe';
  console.log(
    `[e2e-billing-guard] ${functionLabel}: external billing side effects blocked ` +
      `(reason=${reason}; stripe_key_mode=${stripeMode})`,
  );

  const status = clientHint === 'fetch' ? 409 : 200;
  return new Response(JSON.stringify(e2eBillingExternalBlockPayload()), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}
