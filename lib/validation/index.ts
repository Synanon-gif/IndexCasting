/**
 * Central validation & sanitization module for IndexCasting.
 *
 * Import from here across ALL services and components:
 *   import { validateText, sanitizeHtml, validateFile, validateUrl, messageLimiter } from '../../lib/validation';
 *
 * Modules:
 *   text       – text length validation, HTML sanitization, entity escaping
 *   normalize  – input normalization (invisible chars, unicode, repetition) — run FIRST
 *   url        – https-only URL validation, safe link extraction, safe anchor props
 *   file       – MIME whitelist, size limits, magic-byte content verification, extension check
 *   rateLimit  – sliding-window rate limiters with burst detection for messages and uploads
 *
 * Security logging:
 *   logSecurityEvent – fire-and-forget security event logger (lib/security/logger.ts)
 */

export type { ValidationResult, TextValidationOptions } from './text';
export { validateText, sanitizeHtml, escapeHtml } from './text';

export { normalizeInput, stripInvisibleChars } from './normalize';

export { validateUrl, extractSafeUrls, safeLinkProps } from './url';

export type { AllowedMimeType } from './file';
export {
  ALLOWED_MIME_TYPES,
  CHAT_ALLOWED_MIME_TYPES,
  MAX_FILE_SIZE_BYTES,
  DEFAULT_UPLOAD_BASENAME_MAX_LEN,
  validateFile,
  checkMagicBytes,
  checkExtensionConsistency,
  sanitizeUploadBaseName,
} from './file';

export type { RateLimiterOptions, RateLimitResult } from './rateLimit';
export {
  RateLimiter,
  messageLimiter,
  uploadLimiter,
  orgMessageLimiter,
} from './rateLimit';

export type { SecurityEventType, SecurityEventPayload } from '../security/logger';
export { logSecurityEvent } from '../security/logger';
