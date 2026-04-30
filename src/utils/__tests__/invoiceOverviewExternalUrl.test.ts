import { isSafeInvoiceOverviewExternalUrl } from '../invoiceOverviewExternalUrl';

describe('isSafeInvoiceOverviewExternalUrl', () => {
  it('allows Stripe https invoice / payment URLs', () => {
    expect(isSafeInvoiceOverviewExternalUrl('https://invoice.stripe.com/i/acct_123/foo')).toBe(
      true,
    );
    expect(isSafeInvoiceOverviewExternalUrl('https://pay.stripe.com/invoice/foo')).toBe(true);
  });

  it('rejects http and non-Stripe hosts', () => {
    expect(isSafeInvoiceOverviewExternalUrl('http://invoice.stripe.com/i/x')).toBe(false);
    expect(isSafeInvoiceOverviewExternalUrl('https://evil.com/https://invoice.stripe.com/')).toBe(
      false,
    );
    expect(isSafeInvoiceOverviewExternalUrl('https://notstripe.com/')).toBe(false);
  });

  it('rejects javascript: and empty values', () => {
    expect(isSafeInvoiceOverviewExternalUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeInvoiceOverviewExternalUrl('')).toBe(false);
    expect(isSafeInvoiceOverviewExternalUrl(null)).toBe(false);
  });
});
