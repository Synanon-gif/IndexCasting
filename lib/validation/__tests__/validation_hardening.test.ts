/**
 * Security hardening tests — extends the base validation test suite.
 *
 * New test cases:
 * 1. MIME vs magic-byte mismatch → rejected
 * 2. Extension consistency (.png file with JPEG magic bytes) → rejected
 * 3. Rate-limit burst detection → cooldown triggered
 * 4. Invisible character normalization → stripped
 * 5. Large input rejection (>4000 chars)
 * 6. safeLinkProps includes nofollow
 */

import {
  checkMagicBytes,
  validateFile,
  checkExtensionConsistency,
  sanitizeUploadBaseName,
  DEFAULT_UPLOAD_BASENAME_MAX_LEN,
} from '../file';
import { normalizeInput, stripInvisibleChars } from '../normalize';
import { RateLimiter } from '../rateLimit';
import { validateText } from '../text';
import { safeLinkProps } from '../url';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFile(name: string, mimeType: string, bytes: number[]): File {
  return new File([new Uint8Array(bytes)], name, { type: mimeType });
}

function makeLargeFile(name: string, mimeType: string, sizeBytes: number): File {
  return new File([new Uint8Array(sizeBytes)], name, { type: mimeType });
}

// ---------------------------------------------------------------------------
// 1. MIME type vs magic-byte mismatch → rejected
// ---------------------------------------------------------------------------

describe('MIME vs magic-byte mismatch', () => {
  test('file declared as image/jpeg but has PNG magic bytes → rejected', async () => {
    const pngBytesAsMime = makeFile(
      'photo.jpg',
      'image/jpeg',
      // PNG magic bytes: 89 50 4E 47 0D 0A 1A 0A
      [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00],
    );
    const result = await checkMagicBytes(pngBytesAsMime);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/does not match/i);
  });

  test('file declared as application/pdf but has JPEG magic bytes → rejected', async () => {
    const jpegAsPdf = makeFile(
      'doc.pdf',
      'application/pdf',
      [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10],
    );
    const result = await checkMagicBytes(jpegAsPdf);
    expect(result.ok).toBe(false);
  });

  test('file declared as image/png with correct PNG magic bytes → accepted', async () => {
    const realPng = makeFile(
      'photo.png',
      'image/png',
      [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00],
    );
    const result = await checkMagicBytes(realPng);
    expect(result.ok).toBe(true);
  });

  test('file with unknown/disallowed MIME → validateFile rejects before magic check', () => {
    const svgFile = makeLargeFile('image.svg', 'image/svg+xml', 1024);
    const result = validateFile(svgFile);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/not allowed/i);
  });
});

// ---------------------------------------------------------------------------
// 2. Extension consistency check
// ---------------------------------------------------------------------------

describe('Extension consistency (MIME vs filename extension)', () => {
  test('JPEG content with .png extension → rejected', () => {
    const file = makeFile('photo.png', 'image/jpeg', [0xff, 0xd8, 0xff]);
    const result = checkExtensionConsistency(file);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('.png');
      expect(result.error).toMatch(/does not match/i);
    }
  });

  test('PDF content with .jpg extension → rejected', () => {
    const file = makeFile('document.jpg', 'application/pdf', [0x25, 0x50, 0x44, 0x46]);
    const result = checkExtensionConsistency(file);
    expect(result.ok).toBe(false);
  });

  test('File with no extension → rejected', () => {
    const file = makeFile('noextension', 'image/jpeg', [0xff, 0xd8, 0xff]);
    const result = checkExtensionConsistency(file);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/no extension/i);
  });

  test('JPEG content with .jpg extension → accepted', () => {
    const file = makeFile('photo.jpg', 'image/jpeg', [0xff, 0xd8, 0xff]);
    expect(checkExtensionConsistency(file).ok).toBe(true);
  });

  test('JPEG content with .jpeg extension → accepted', () => {
    const file = makeFile('photo.jpeg', 'image/jpeg', [0xff, 0xd8, 0xff]);
    expect(checkExtensionConsistency(file).ok).toBe(true);
  });

  test('PDF with .pdf extension → accepted', () => {
    const file = makeFile('doc.pdf', 'application/pdf', [0x25, 0x50, 0x44, 0x46]);
    expect(checkExtensionConsistency(file).ok).toBe(true);
  });

  test('Blob (no filename) → accepted (no extension check for Blobs)', () => {
    const blob = new Blob([new Uint8Array([0xff, 0xd8])], { type: 'image/jpeg' });
    expect(checkExtensionConsistency(blob).ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. Burst detection → cooldown triggered
// ---------------------------------------------------------------------------

describe('Rate limit burst detection and cooldown', () => {
  test('5 rapid actions trigger cooldown on the 6th call', () => {
    const limiter = new RateLimiter({
      maxCount: 30,
      windowMs: 60_000,
      burstCount: 5,
      burstWindowMs: 3000,
      cooldownMs: 30_000,
    });
    const key = 'user-burst-test';
    // Allow 5 actions — each succeeds; the 5th fills the burst window
    for (let i = 0; i < 5; i++) {
      expect(limiter.check(key).ok).toBe(true);
    }
    // 6th action sees 5 timestamps in burst window → cooldown triggered
    const result = limiter.check(key);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.isCooldown).toBe(true);
      expect(result.retryAfterMs).toBeGreaterThan(0);
      expect(result.error).toMatch(/burst|too fast/i);
    }
  });

  test('cooldown persists after burst for subsequent calls', () => {
    const limiter = new RateLimiter({
      maxCount: 30,
      windowMs: 60_000,
      burstCount: 3,
      burstWindowMs: 3000,
      cooldownMs: 30_000,
    });
    const key = 'user-cooldown-persist';
    for (let i = 0; i < 3; i++) limiter.check(key);
    // Trigger burst
    limiter.check(key);
    // Next call should also be blocked by cooldown
    const blocked = limiter.check(key);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.isCooldown).toBe(true);
  });

  test('isInCooldown() returns true during active cooldown', () => {
    const limiter = new RateLimiter({
      maxCount: 30,
      windowMs: 60_000,
      burstCount: 3,
      burstWindowMs: 3000,
      cooldownMs: 30_000,
    });
    const key = 'user-cooldown-check';
    for (let i = 0; i < 4; i++) limiter.check(key);
    expect(limiter.isInCooldown(key)).toBe(true);
  });

  test('reset() clears cooldown', () => {
    const limiter = new RateLimiter({ maxCount: 30, windowMs: 60_000, burstCount: 3, burstWindowMs: 3000, cooldownMs: 30_000 });
    const key = 'user-reset-test';
    for (let i = 0; i < 4; i++) limiter.check(key);
    expect(limiter.isInCooldown(key)).toBe(true);
    limiter.reset(key);
    expect(limiter.isInCooldown(key)).toBe(false);
    expect(limiter.check(key).ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. Invisible character normalization
// ---------------------------------------------------------------------------

describe('Input normalization (invisible chars, repetition, unicode)', () => {
  test('zero-width space is stripped', () => {
    const input = 'hello\u200Bworld';
    expect(normalizeInput(input)).toBe('helloworld');
  });

  test('BOM (\\uFEFF) is stripped', () => {
    const input = '\uFEFFHello';
    expect(normalizeInput(input)).toBe('Hello');
  });

  test('soft hyphen (\\u00AD) is stripped', () => {
    const input = 'hel\u00ADlo';
    expect(normalizeInput(input)).toBe('hello');
  });

  test('multiple invisible chars stripped together', () => {
    const input = '\u200B\uFEFF\u00ADvisible\u200B\u200C';
    expect(normalizeInput(input)).toBe('visible');
  });

  test('excessive character repetition collapsed to 3', () => {
    expect(normalizeInput('heeeeello')).toBe('heeello');
    expect(normalizeInput('!!!!!!!!!!')).toBe('!!!');
    expect(normalizeInput('aaaa')).toBe('aaa');
  });

  test('normal text passes through unchanged (after trim)', () => {
    const input = '  Hello World  ';
    expect(normalizeInput(input)).toBe('Hello World');
  });

  test('stripInvisibleChars leaves visible text intact', () => {
    const input = 'Hello \u200B World';
    expect(stripInvisibleChars(input)).toBe('Hello  World');
  });

  test('empty string returns empty string', () => {
    expect(normalizeInput('')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// 5. Large input rejection
// ---------------------------------------------------------------------------

describe('Large payload rejection', () => {
  test('validateText rejects input over 4000 chars with custom maxLength', () => {
    const huge = 'a'.repeat(4001);
    expect(validateText(huge, { maxLength: 4000 }).ok).toBe(false);
  });

  test('validateText accepts input exactly at 4000 chars', () => {
    const max = 'a'.repeat(4000);
    expect(validateText(max, { maxLength: 4000 }).ok).toBe(true);
  });

  test('normalizeInput does not bypass length check (repetition collapsed first)', () => {
    // 3000 repetitions of 'a' → collapsed to 'aaa' by normalizeInput
    const spamText = 'a'.repeat(3000);
    const normalized = normalizeInput(spamText);
    expect(normalized.length).toBe(3); // collapsed
    expect(validateText(normalized, { maxLength: 2000 }).ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 6. sanitizeUploadBaseName
// ---------------------------------------------------------------------------

describe('sanitizeUploadBaseName', () => {
  test('replaces unsafe characters with underscore', () => {
    expect(sanitizeUploadBaseName('my file (1).pdf')).toBe('my_file__1_.pdf');
  });

  test('truncates to max length', () => {
    const long = 'a'.repeat(DEFAULT_UPLOAD_BASENAME_MAX_LEN + 50);
    expect(sanitizeUploadBaseName(long).length).toBe(DEFAULT_UPLOAD_BASENAME_MAX_LEN);
  });

  test('preserves allowed charset', () => {
    expect(sanitizeUploadBaseName('Photo_01-final.jpg')).toBe('Photo_01-final.jpg');
  });
});

// ---------------------------------------------------------------------------
// 7. safeLinkProps includes nofollow
// ---------------------------------------------------------------------------

describe('Link safety props', () => {
  test('safeLinkProps includes noopener', () => {
    expect(safeLinkProps.rel).toContain('noopener');
  });

  test('safeLinkProps includes noreferrer', () => {
    expect(safeLinkProps.rel).toContain('noreferrer');
  });

  test('safeLinkProps includes nofollow', () => {
    expect(safeLinkProps.rel).toContain('nofollow');
  });

  test('safeLinkProps target is _blank', () => {
    expect(safeLinkProps.target).toBe('_blank');
  });
});
