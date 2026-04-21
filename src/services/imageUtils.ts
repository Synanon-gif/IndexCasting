/**
 * Shared image utilities for pre-upload processing.
 */

import { Platform } from 'react-native';
import imageCompression from 'browser-image-compression';

/**
 * Strips EXIF metadata (including GPS coordinates) from an image by
 * re-encoding it through the Canvas API via browser-image-compression.
 * Works in browsers and Capacitor WKWebView (iOS/Android).
 * Returns the original file if compression fails (graceful degradation).
 * Only processes File objects — Blobs without a type are returned unchanged.
 */
export async function stripExifAndCompress(file: File | Blob): Promise<File | Blob> {
  if (!(file instanceof File)) return file;
  const mime = (file.type ?? '').toLowerCase();
  if (!mime.startsWith('image/')) return file;
  try {
    const compressed = await imageCompression(file, {
      maxSizeMB: 15,
      useWebWorker: true,
      maxWidthOrHeight: 4096,
      fileType: file.type as 'image/jpeg' | 'image/png' | 'image/webp',
    });
    return compressed;
  } catch (e) {
    console.warn('stripExifAndCompress: compression failed, using original', e);
    return file;
  }
}

export type HeicConvertResult = {
  file: File | Blob;
  /** True when input was HEIC/HEIF but conversion failed; `file` is still HEIC/HEIF. */
  conversionFailed: boolean;
};

/** True if the file is HEIC/HEIF by MIME or by filename (some browsers omit type). */
export function isHeicOrHeifFile(file: File | Blob): boolean {
  const mime = (file.type ?? '').toLowerCase();
  if (mime === 'image/heic' || mime === 'image/heif') return true;
  if (file instanceof File) {
    const n = file.name.toLowerCase();
    return n.endsWith('.heic') || n.endsWith('.heif');
  }
  return false;
}

/**
 * Converts HEIC/HEIF to JPEG. Non-HEIC files are returned with conversionFailed: false.
 * Callers can show UX when conversionFailed is true (browser cannot process this file).
 *
 * Multi-strategy converter (in order):
 *   1. `heic-to` (libheif 1.21.x — supports modern iPhone HEVC HEIC variants)
 *   2. `heic2any`  (libheif 1.16 — older fallback for legacy HEIC)
 *   3. Native `<img>` decode + canvas re-encode (Safari decodes HEIC natively;
 *      some Chromium builds via system codecs)
 *
 * Why three strategies: real-world iPhones produce HEIC files that fail libheif
 * 1.16 ("ERR_LIBHEIF format not supported"), and even libheif 1.21 occasionally
 * stumbles on burst/multi-frame containers. The `<img>` fallback captures
 * everything Safari can render natively, which closes the last gap on iOS-uploaded
 * photos viewed from a Mac.
 *
 * On true React Native (`Platform.OS === 'ios' | 'android'`) we still bail —
 * the native picker should have already produced a JPEG, and bundling libheif
 * WASM into the RN binary is wasteful.
 */
export async function convertHeicToJpegWithStatus(file: File | Blob): Promise<HeicConvertResult> {
  if (!isHeicOrHeifFile(file)) {
    return { file, conversionFailed: false };
  }

  if (Platform.OS === 'ios' || Platform.OS === 'android') {
    return { file, conversionFailed: true };
  }

  const sizeOk = (file as File).size === undefined ? true : (file as File).size > 0;
  if (!sizeOk) {
    return { file, conversionFailed: true };
  }

  const originalName = file instanceof File ? file.name : 'photo.heic';
  const jpegName = originalName.replace(/\.hei[cf]$/i, '.jpg');
  const wrap = (blob: Blob): HeicConvertResult => ({
    file: new File([blob], jpegName, { type: 'image/jpeg' }),
    conversionFailed: false,
  });

  // ── Strategy 1: heic-to (libheif 1.21.x, current iPhone HEVC support) ─────
  try {
    const mod = (await import('heic-to')) as {
      heicTo?: (opts: { blob: Blob; type?: string; quality?: number }) => Promise<Blob>;
      default?: {
        heicTo?: (opts: { blob: Blob; type?: string; quality?: number }) => Promise<Blob>;
      };
    };
    const heicTo =
      mod.heicTo ?? (mod.default && typeof mod.default === 'object' ? mod.default.heicTo : null);
    if (heicTo) {
      const converted = await heicTo({ blob: file, type: 'image/jpeg', quality: 0.92 });
      if (converted && (converted as Blob).size > 0) return wrap(converted as Blob);
    }
  } catch (e) {
    console.warn('convertHeicToJpegWithStatus: heic-to failed, trying heic2any', e);
  }

  // ── Strategy 2: heic2any (older libheif, kept as compatibility fallback) ──
  try {
    const mod = (await import('heic2any')) as
      | {
          default?: (opts: {
            blob: Blob;
            toType?: string;
            quality?: number;
          }) => Promise<Blob | Blob[]>;
        }
      | ((opts: { blob: Blob; toType?: string; quality?: number }) => Promise<Blob | Blob[]>);
    const heic2any = (typeof mod === 'function' ? mod : mod.default) ?? null;
    if (heic2any) {
      const converted = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.92 });
      const resultBlob = Array.isArray(converted) ? converted[0] : converted;
      if (resultBlob && (resultBlob as Blob).size > 0) return wrap(resultBlob as Blob);
    }
  } catch (e) {
    console.warn('convertHeicToJpegWithStatus: heic2any failed, trying native decode', e);
  }

  // ── Strategy 3: native browser HEIC decode via <img> + canvas ─────────────
  // Safari/macOS Chrome can decode HEIC via system frameworks; this path
  // succeeds where libheif WASM does not (e.g. Apple HEIC/HEIC-ProRes).
  try {
    const nativeBlob = await decodeWithCanvas(file);
    if (nativeBlob && nativeBlob.size > 0) return wrap(nativeBlob);
  } catch (e) {
    console.error('convertHeicToJpegWithStatus: native decode failed', e);
  }

  console.error('convertHeicToJpegWithStatus: all conversion strategies failed', {
    name: originalName,
    type: file.type,
    size: (file as File).size,
  });
  return { file, conversionFailed: true };
}

/**
 * Decodes any browser-renderable image (including HEIC on Safari) via a
 * detached <img> element and re-encodes the result as a JPEG via canvas.
 */
async function decodeWithCanvas(file: File | Blob): Promise<Blob | null> {
  if (typeof document === 'undefined' || typeof URL === 'undefined') return null;
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement | null>((resolve) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => resolve(null);
      el.src = url;
    });
    if (!img || img.naturalWidth === 0 || img.naturalHeight === 0) return null;
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0);
    return await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.92),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Converts a HEIC or HEIF file to JPEG before further processing.
 * All other file types are returned unchanged.
 *
 * This must be called BEFORE validateFile so the downstream validation
 * and compression pipeline always receives a standard JPEG/PNG/WebP.
 * On conversion failure, returns the original blob (legacy behavior for callers
 * that do not check {@link convertHeicToJpegWithStatus}).
 */
export async function convertHeicToJpegIfNeeded(file: File | Blob): Promise<File | Blob> {
  const { file: out } = await convertHeicToJpegWithStatus(file);
  return out;
}
