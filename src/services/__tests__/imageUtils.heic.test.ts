/**
 * Web: HEIC must not load heic2any (bundle/import can fail). These tests mock Platform.OS = web.
 */
jest.mock('react-native', () => ({ Platform: { OS: 'web' } }));

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
  it('returns conversionFailed for HEIC without loading heic2any', async () => {
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
