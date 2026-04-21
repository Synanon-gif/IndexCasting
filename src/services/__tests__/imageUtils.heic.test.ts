/**
 * HEIC pipeline tests — Platform.OS = 'web' so `convertHeicToJpegWithStatus`
 * actually attempts the WASM dynamic imports (the previous "do not load on web"
 * guard caused every iPhone HEIC upload to fail in production).
 *
 * The function tries three strategies in order: heic-to → heic2any → native
 * canvas decode. We mock the first two and ensure the third (canvas) is not
 * exercised in jsdom (no real HEIC decoder).
 */
jest.mock('react-native', () => ({ Platform: { OS: 'web' } }));

const heicToFailingHeics = new Set<string>();

jest.mock(
  'heic-to',
  () => ({
    __esModule: true,
    heicTo: jest.fn(async ({ blob }: { blob: Blob }) => {
      if ((blob as { size?: number }).size === 0) {
        throw new Error('ERR_LIBHEIF format not supported');
      }
      const name = (blob as File).name ?? '';
      if (heicToFailingHeics.has(name)) {
        throw new Error('ERR_LIBHEIF format not supported');
      }
      return new Blob(['heic-to-converted'], { type: 'image/jpeg' });
    }),
  }),
  { virtual: true },
);

jest.mock(
  'heic2any',
  () => ({
    __esModule: true,
    default: jest.fn(async ({ blob }: { blob: Blob }) => {
      if ((blob as { size?: number }).size === 0) {
        throw new Error('empty buffer');
      }
      return new Blob(['heic2any-converted'], { type: 'image/jpeg' });
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
  beforeEach(() => {
    heicToFailingHeics.clear();
  });

  it('attempts heic-to on web and returns a JPEG File when conversion succeeds', async () => {
    const buf = new Uint8Array([0xff, 0xd8, 0xff, 0x00]);
    const f = new File([buf], 'p.heic', { type: 'image/heic' });
    const r = await convertHeicToJpegWithStatus(f);
    expect(r.conversionFailed).toBe(false);
    expect(r.file).toBeInstanceOf(File);
    expect((r.file as File).type).toBe('image/jpeg');
    expect((r.file as File).name).toBe('p.jpg');
  });

  it('falls back to heic2any when heic-to throws ERR_LIBHEIF (newer iPhone HEVC)', async () => {
    const buf = new Uint8Array([0xff, 0xd8, 0xff, 0x00]);
    heicToFailingHeics.add('iphone-hevc.heic');
    const f = new File([buf], 'iphone-hevc.heic', { type: 'image/heic' });
    const r = await convertHeicToJpegWithStatus(f);
    expect(r.conversionFailed).toBe(false);
    expect((r.file as File).type).toBe('image/jpeg');
    expect((r.file as File).name).toBe('iphone-hevc.jpg');
  });

  it('returns conversionFailed when every strategy fails (e.g. empty blob)', async () => {
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
