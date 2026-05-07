import { isLikelyStaleWebBundleError } from '../webChunkLoadRecovery';

describe('webChunkLoadRecovery — isLikelyStaleWebBundleError', () => {
  it('detects HTML-as-JS SyntaxError', () => {
    expect(isLikelyStaleWebBundleError(new SyntaxError("Unexpected token '<'"))).toBe(true);
  });

  it('detects dynamic import fetch failure', () => {
    expect(
      isLikelyStaleWebBundleError(new Error('Failed to fetch dynamically imported module')),
    ).toBe(true);
  });

  it('detects Metro unknown module', () => {
    expect(isLikelyStaleWebBundleError(new Error('Requiring unknown module "1184"'))).toBe(true);
  });

  it('rejects unrelated errors', () => {
    expect(isLikelyStaleWebBundleError(new Error('Network request failed'))).toBe(false);
    expect(isLikelyStaleWebBundleError(null)).toBe(false);
  });
});
