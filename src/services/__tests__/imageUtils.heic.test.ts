/**
 * HEIC pipeline tests — Platform.OS = 'web' so `convertHeicToJpegWithStatus`
 * actually attempts the heic2any dynamic import (the previous "do not load on web"
 * guard caused every iPhone HEIC upload to fail in production).
 */
jest.mock('react-native', () => ({ Platform: { OS: 'web' } }));

// heic2any cannot run inside jsdom (no Canvas / WebAssembly stubs). We stub the module
// so the function code path is exercised end-to-end without pulling the 1.4MB lib.
jest.mock(
  'heic2any',
  () => ({
    __esModule: true,
    default: jest.fn(async ({ blob }: { blob: Blob }) => {
      // Empty blobs are treated as "cannot convert" (matches real heic2any behavior).
      if ((blob as { size?: number }).size === 0) {
        throw new Error('empty buffer');
      }
      return new Blob(['converted'], { type: 'image/jpeg' });
    }),
  }),
  { virtual: true },
);

import { convertHeicToJpegWithStatus, isHeicOrHeifFile } from '../imageUtils';

describe('imageUtils — HEIC detection', () => {
  it('detects image/heic', () => {
    expect(isHeicOrHeifFile(new File([], 'x', { type: 'image/heic' }))).toBe(true);
  });
  it('detects image/heif', () => {
    expect(isHeicOrHeifFile(new File([], 'x', { type: 'image/heif' }))).toBe(true);
  });
  it('detects .heic with empty MIME (some browsers)', () => {
    expect(isHeicOrHeifFile(new File([], 'photo.heic', { type: '' }))).toBe(true);
  });
  it('is false for JPEG', () => {
    expect(isHeicOrHeifFile(new File([], 'a.jpg', { type: 'image/jpeg' }))).toBe(false);
  });
  it('is false for PNG', () => {
    expect(isHeicOrHeifFile(new File([], 'a.png', { type: 'image/png' }))).toBe(false);
  });
});

describe('imageUtils — convertHeicToJpegWithStatus (web)', () => {
  it('attempts heic2any on web and returns a JPEG File when conversion succeeds', async () => {
    const buf = new Uint8Array([0xff, 0xd8, 0xff, 0x00]); // non-empty payload
    const f = new File([buf], 'p.heic', { type: 'image/heic' });
    const r = await convertHeicToJpegWithStatus(f);
    expect(r.conversionFailed).toBe(false);
    expect(r.file).toBeInstanceOf(File);
    expect((r.file as File).type).toBe('image/jpeg');
    expect((r.file as File).name).toBe('p.jpg');
  });

  it('returns conversionFailed when the underlying conversion throws (e.g. empty blob)', async () => {
    const f = new File([], 'p.heic', { type: 'image/heic' });
    const r = await convertHeicToJpegWithStatus(f);
    expect(r.conversionFailed).toBe(true);
    expect(r.file).toBe(f);
  });

  it('passes JPEG through unchanged', async () => {
    const f = new File([], 'p.jpg', { type: 'image/jpeg' });
    const r = await convertHeicToJpegWithStatus(f);
    expect(r.conversionFailed).toBe(false);
    expect(r.file).toBe(f);
  });

  it('passes PNG through unchanged', async () => {
    const f = new File([], 'p.png', { type: 'image/png' });
    const r = await convertHeicToJpegWithStatus(f);
    expect(r.conversionFailed).toBe(false);
    expect(r.file).toBe(f);
  });
});
