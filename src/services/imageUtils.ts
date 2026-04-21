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
 * Works on:
 *   - Web (browser): dynamic-imports `heic2any` (browser-only, uses Canvas + WebAssembly).
 *   - Native (iOS/Android via Capacitor/Expo Web): same dynamic import — heic2any only
 *     runs in WebView contexts.
 *
 * Defense-in-depth:
 *   - If `heic2any` cannot be imported (e.g. no Canvas in test env, SSR, ad-blocker), we
 *     return `conversionFailed: true` so callers can render explicit UX rather than
 *     silently uploading an unviewable HEIC.
 *   - Empty buffers / corrupt files surface as `conversionFailed: true` (heic2any throws).
 *   - On true React Native (no DOM Canvas) `Platform.OS === 'ios' | 'android'`, heic2any
 *     is not loaded and we return `conversionFailed: true` — the native picker should
 *     have already converted to JPEG, but if not, callers must surface the failure.
 */
export async function convertHeicToJpegWithStatus(file: File | Blob): Promise<HeicConvertResult> {
  if (!isHeicOrHeifFile(file)) {
    return { file, conversionFailed: false };
  }

  // True React Native (not the web shim) cannot run heic2any — bail without attempting.
  if (Platform.OS === 'ios' || Platform.OS === 'android') {
    return { file, conversionFailed: true };
  }

  // Web (and Capacitor WebView, which still reports OS='web' via react-native-web).
  // Empty / zero-byte files cannot be converted — short-circuit so test doubles and
  // adversarial inputs don't crash heic2any internally.
  const sizeOk = (file as File).size === undefined ? true : (file as File).size > 0;
  if (!sizeOk) {
    return { file, conversionFailed: true };
  }

  let heic2any:
    | ((opts: { blob: Blob; toType?: string; quality?: number }) => Promise<Blob | Blob[]>)
    | null = null;
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
    heic2any = (typeof mod === 'function' ? mod : mod.default) ?? null;
  } catch (e) {
    console.warn('convertHeicToJpegWithStatus: heic2any module failed to load', e);
    return { file, conversionFailed: true };
  }

  if (!heic2any) {
    return { file, conversionFailed: true };
  }

  try {
    const converted = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.92 });
    const resultBlob = Array.isArray(converted) ? converted[0] : converted;
    const originalName = file instanceof File ? file.name : 'photo.heic';
    const jpegName = originalName.replace(/\.hei[cf]$/i, '.jpg');
    return {
      file: new File([resultBlob], jpegName, { type: 'image/jpeg' }),
      conversionFailed: false,
    };
  } catch (e) {
    console.error('convertHeicToJpegWithStatus: conversion failed', e);
    return { file, conversionFailed: true };
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
