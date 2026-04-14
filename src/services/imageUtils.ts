/**
 * Shared image utilities for pre-upload processing.
 */

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

/**
 * Converts HEIC/HEIF to JPEG. Non-HEIC files are returned with conversionFailed: false.
 * Callers can show UX when conversionFailed is true (browser cannot process this file).
 */
export async function convertHeicToJpegWithStatus(file: File | Blob): Promise<HeicConvertResult> {
  const mime = (file.type ?? '').toLowerCase();
  if (mime !== 'image/heic' && mime !== 'image/heif') {
    return { file, conversionFailed: false };
  }

  try {
    const heic2any = (await import('heic2any')).default;
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
