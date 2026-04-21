/**
 * File upload validation utilities.
 * Validates MIME type, file size, and magic bytes (actual file content signature).
 * Magic-byte checks prevent renamed executable files from being uploaded.
 */

import type { ValidationResult } from './text';

/** Maximum allowed file size: 200 MB */
export const MAX_FILE_SIZE_BYTES = 200 * 1024 * 1024;

/**
 * Allowed MIME types for generic validation (`validateFile`).
 * Callers narrow further: model portfolio/polaroid paths use images only; chat and option
 * attachments use this list including PDF; see `uploadModelPhoto` vs `uploadOptionDocument`.
 */
export const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'application/pdf',
] as const;

export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

/** Allowed MIME types for chat file attachments (superset: also allows common docs). */
export const CHAT_ALLOWED_MIME_TYPES: readonly string[] = [...ALLOWED_MIME_TYPES];

/**
 * Known magic byte signatures for allowed file types.
 * Each entry maps a MIME type to one or more valid byte sequences at offset 0.
 */
const MAGIC_BYTES: Record<string, number[][]> = {
  'image/jpeg': [[0xff, 0xd8, 0xff]],
  'image/png': [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  'image/webp': [
    // WebP: "RIFF" at bytes 0-3, "WEBP" at bytes 8-11
    // We check RIFF + WEBP in the 12-byte slice
    [0x52, 0x49, 0x46, 0x46], // "RIFF" — WEBP marker at offset 8 checked separately
  ],
  'application/pdf': [
    [0x25, 0x50, 0x44, 0x46], // "%PDF"
  ],
  // HEIC/HEIF: special-cased below (ftyp box at offset 4, brand at offset 8)
  'image/heic': [],
  'image/heif': [],
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

  // HEIC/HEIF special case: ftyp box at offset 4-7, HEIC brand at offset 8-11
  if (mimeType === 'image/heic' || mimeType === 'image/heif') {
    const heicHeader = await readFileHeader(file, 12);
    if (!heicHeader || heicHeader.length < 12) return { ok: true };
    const isFtyp =
      heicHeader[4] === 0x66 && // 'f'
      heicHeader[5] === 0x74 && // 't'
      heicHeader[6] === 0x79 && // 'y'
      heicHeader[7] === 0x70; // 'p'
    if (!isFtyp) {
      return { ok: false, error: 'File content does not match the declared type (HEIC/HEIF).' };
    }
    const brand = String.fromCharCode(heicHeader[8], heicHeader[9], heicHeader[10], heicHeader[11]);
    const validBrands = [
      'heic',
      'heix',
      'hevc',
      'hevx',
      'mif1',
      'msf1',
      'heif',
      'heim',
      'heis',
      'hevm',
      'hevs',
    ];
    if (!validBrands.includes(brand)) {
      return { ok: false, error: 'File content does not match the declared type (HEIC/HEIF).' };
    }
    return { ok: true };
  }

  // WebP special case: check RIFF at [0-3] AND WEBP at [8-11]
  if (mimeType === 'image/webp') {
    const isRiff =
      header[0] === 0x52 && header[1] === 0x49 && header[2] === 0x46 && header[3] === 0x46;
    const isWebp =
      header[8] === 0x57 && header[9] === 0x45 && header[10] === 0x42 && header[11] === 0x50;
    if (!isRiff || !isWebp) {
      return { ok: false, error: 'File content does not match the declared type (WebP).' };
    }
    return { ok: true };
  }

  const matched = signatures.some((sig) => sig.every((byte, i) => header[i] === byte));

  if (!matched) {
    return {
      ok: false,
      error:
        'File content does not match the declared type. Renamed executable files are not allowed.',
    };
  }

  return { ok: true };
}

/** Filename-extension → MIME fallback for browsers that report `file.type === ''`
 * (notably Windows/Linux Chrome with HEIC/HEIF files exported from iPhones). The
 * original `validateFile` rejected such uploads BEFORE the HEIC pipeline could run,
 * so this map is the canonical recovery path used by `inferMimeFromName` and
 * `validateFile`. Keep aligned with `ALLOWED_MIME_TYPES`. */
const EXTENSION_MIME_FALLBACK: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
  pdf: 'application/pdf',
};

/** Best-effort MIME inference from filename extension. Returns '' if unknown. */
export function inferMimeFromName(name: string): string {
  const lower = (name ?? '').toLowerCase();
  const dot = lower.lastIndexOf('.');
  if (dot === -1) return '';
  const ext = lower.slice(dot + 1);
  return EXTENSION_MIME_FALLBACK[ext] ?? '';
}

/**
 * Validates a file for upload:
 * 1. MIME type must be in the allowed whitelist.
 * 2. File size must not exceed MAX_FILE_SIZE_BYTES.
 *
 * Does NOT check magic bytes (call checkMagicBytes separately for full validation).
 *
 * If `file.type` is empty (some browsers do not report a MIME for HEIC/HEIF files
 * exported by iPhones), we transparently fall back to the filename extension via
 * {@link inferMimeFromName} so the HEIC conversion pipeline downstream can run.
 */
export function validateFile(
  file: File | Blob,
  allowedTypes: readonly string[] = ALLOWED_MIME_TYPES,
): ValidationResult {
  let mimeType = file.type;

  if (!mimeType && file instanceof File) {
    mimeType = inferMimeFromName(file.name);
  }

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
  'image/png': ['png'],
  'image/webp': ['webp'],
  'image/heic': ['heic', 'heif'],
  'image/heif': ['heif', 'heic'],
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

/**
 * Returns true when the file looks like an image — including HEIC/HEIF files
 * whose browser-reported `file.type` may be empty on Windows/Linux.
 * Use this instead of `file.type.startsWith('image/')` anywhere a pre-conversion
 * image gate is needed.
 */
export function isImageFile(file: File | Blob): boolean {
  const mime = (file.type ?? '').toLowerCase();
  if (mime.startsWith('image/')) return true;
  if (file instanceof File) {
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    if (
      ['heic', 'heif', 'jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'tiff', 'tif', 'avif'].includes(
        ext,
      )
    ) {
      return true;
    }
  }
  return false;
}

/** Max length for storage path basename segments (matches services default). */
export const DEFAULT_UPLOAD_BASENAME_MAX_LEN = 200;

/**
 * Sanitizes a filename for safe use in storage paths: allowed charset only, max length.
 * Use for the basename segment after `Date.now()_` (not for full paths).
 */
export function sanitizeUploadBaseName(
  name: string,
  maxLen: number = DEFAULT_UPLOAD_BASENAME_MAX_LEN,
): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, maxLen);
}
