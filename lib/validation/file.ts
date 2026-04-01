/**
 * File upload validation utilities.
 * Validates MIME type, file size, and magic bytes (actual file content signature).
 * Magic-byte checks prevent renamed executable files from being uploaded.
 */

import type { ValidationResult } from './text';

/** Maximum allowed file size: 200 MB */
export const MAX_FILE_SIZE_BYTES = 200 * 1024 * 1024;

/** Allowed MIME types for all file uploads across the platform. */
export const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
] as const;

export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

/** Allowed MIME types for chat file attachments (superset: also allows common docs). */
export const CHAT_ALLOWED_MIME_TYPES: readonly string[] = [
  ...ALLOWED_MIME_TYPES,
];

/**
 * Known magic byte signatures for allowed file types.
 * Each entry maps a MIME type to one or more valid byte sequences at offset 0.
 */
const MAGIC_BYTES: Record<string, number[][]> = {
  'image/jpeg': [
    [0xff, 0xd8, 0xff],
  ],
  'image/png': [
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  ],
  'image/webp': [
    // WebP: "RIFF" at bytes 0-3, "WEBP" at bytes 8-11
    // We check RIFF + WEBP in the 12-byte slice
    [0x52, 0x49, 0x46, 0x46], // "RIFF" — WEBP marker at offset 8 checked separately
  ],
  'application/pdf': [
    [0x25, 0x50, 0x44, 0x46], // "%PDF"
  ],
};

/**
 * Reads the first `length` bytes of a File or Blob.
 * Returns null if the file cannot be read (e.g. in environments without FileReader).
 */
async function readFileHeader(file: File | Blob, length: number): Promise<Uint8Array | null> {
  try {
    const slice = file.slice(0, length);
    const buffer = await slice.arrayBuffer();
    return new Uint8Array(buffer);
  } catch {
    return null;
  }
}

/**
 * Checks whether the file's actual content matches its declared MIME type
 * by inspecting magic bytes (file signature).
 *
 * Prevents uploading a renamed .exe or .js file as image.jpg.
 * Returns { ok: true } if signature matches or if reading is not possible
 * (graceful degradation — MIME + size check still applies).
 */
export async function checkMagicBytes(file: File | Blob): Promise<ValidationResult> {
  const mimeType = file.type;
  const signatures = MAGIC_BYTES[mimeType];

  if (!signatures) {
    // No known magic bytes for this MIME type — skip byte check
    return { ok: true };
  }

  const header = await readFileHeader(file, 12);
  if (!header || header.length === 0) {
    // Cannot read file in this environment — allow (MIME check is still enforced)
    return { ok: true };
  }

  // WebP special case: check RIFF at [0-3] AND WEBP at [8-11]
  if (mimeType === 'image/webp') {
    const isRiff =
      header[0] === 0x52 &&
      header[1] === 0x49 &&
      header[2] === 0x46 &&
      header[3] === 0x46;
    const isWebp =
      header[8] === 0x57 &&
      header[9] === 0x45 &&
      header[10] === 0x42 &&
      header[11] === 0x50;
    if (!isRiff || !isWebp) {
      return { ok: false, error: 'File content does not match the declared type (WebP).' };
    }
    return { ok: true };
  }

  const matched = signatures.some((sig) =>
    sig.every((byte, i) => header[i] === byte),
  );

  if (!matched) {
    return {
      ok: false,
      error: 'File content does not match the declared type. Renamed executable files are not allowed.',
    };
  }

  return { ok: true };
}

/**
 * Validates a file for upload:
 * 1. MIME type must be in the allowed whitelist.
 * 2. File size must not exceed MAX_FILE_SIZE_BYTES.
 *
 * Does NOT check magic bytes (call checkMagicBytes separately for full validation).
 */
export function validateFile(
  file: File | Blob,
  allowedTypes: readonly string[] = ALLOWED_MIME_TYPES,
): ValidationResult {
  const mimeType = file.type;

  if (!mimeType) {
    return { ok: false, error: 'File type could not be determined.' };
  }

  if (!(allowedTypes as string[]).includes(mimeType)) {
    return {
      ok: false,
      error: `File type "${mimeType}" is not allowed. Allowed types: ${allowedTypes.join(', ')}.`,
    };
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    const maxMb = MAX_FILE_SIZE_BYTES / (1024 * 1024);
    const fileMb = (file.size / (1024 * 1024)).toFixed(1);
    return {
      ok: false,
      error: `File size ${fileMb} MB exceeds the maximum of ${maxMb} MB.`,
    };
  }

  if (file.size === 0) {
    return { ok: false, error: 'File is empty.' };
  }

  return { ok: true };
}

/**
 * Maps MIME types to their accepted file extensions (lowercase, without dot).
 */
const MIME_TO_EXTENSIONS: Record<string, string[]> = {
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png':  ['png'],
  'image/webp': ['webp'],
  'application/pdf': ['pdf'],
};

/**
 * Checks that the file's extension is consistent with its declared MIME type.
 * Prevents triple-spoofing: MIME says jpeg, magic bytes say jpeg, but extension is .exe.
 *
 * Only enforced for File objects (Blobs have no name). Returns { ok: true } for Blobs.
 */
export function checkExtensionConsistency(file: File | Blob): ValidationResult {
  if (!(file instanceof File)) {
    // Blobs have no filename — skip check
    return { ok: true };
  }

  const mimeType = file.type;
  const expectedExtensions = MIME_TO_EXTENSIONS[mimeType];

  if (!expectedExtensions) {
    // MIME type not in our map — validateFile will catch this; skip here
    return { ok: true };
  }

  const rawName = file.name ?? '';
  const dotIndex = rawName.lastIndexOf('.');
  if (dotIndex === -1) {
    return {
      ok: false,
      error: 'File has no extension. Please use a file with a valid extension (e.g. .jpg, .pdf).',
    };
  }

  const ext = rawName.slice(dotIndex + 1).toLowerCase();

  if (!expectedExtensions.includes(ext)) {
    return {
      ok: false,
      error: `File extension ".${ext}" does not match the file type "${mimeType}". Expected: .${expectedExtensions.join(' or .')}.`,
    };
  }

  return { ok: true };
}
