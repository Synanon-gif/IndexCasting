/**
 * Shared image utilities for pre-upload processing.
 */

/**
 * Converts a HEIC or HEIF file to JPEG before further processing.
 * All other file types are returned unchanged.
 *
 * This must be called BEFORE validateFile so the downstream validation
 * and compression pipeline always receives a standard JPEG/PNG/WebP.
 */
export async function convertHeicToJpegIfNeeded(file: File | Blob): Promise<File | Blob> {
  const mime = (file.type ?? '').toLowerCase();
  if (mime !== 'image/heic' && mime !== 'image/heif') return file;

  try {
    const heic2any = (await import('heic2any')).default;
    const converted = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.92 });
    const resultBlob = Array.isArray(converted) ? converted[0] : converted;
    const originalName = file instanceof File ? file.name : 'photo.heic';
    const jpegName = originalName.replace(/\.hei[cf]$/i, '.jpg');
    return new File([resultBlob], jpegName, { type: 'image/jpeg' });
  } catch (e) {
    console.error('convertHeicToJpegIfNeeded: conversion failed', e);
    // Graceful degradation: return original — downstream validateFile will reject it
    return file;
  }
}
