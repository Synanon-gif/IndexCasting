/**
 * Central text validation and sanitization utilities.
 * Used across all user-facing input surfaces (chat, forms, profiles).
 * NEVER trust raw input — always sanitize before storing or rendering.
 */

export type ValidationResult = { ok: true } | { ok: false; error: string };

export interface TextValidationOptions {
  /** Maximum allowed character length. Defaults to 2000. */
  maxLength?: number;
  /** Minimum required character length. Defaults to 1. */
  minLength?: number;
  /** Allow empty string (skip minLength check). Defaults to false. */
  allowEmpty?: boolean;
}

/**
 * Validates a text input for length and basic sanity.
 * Does NOT sanitize — call sanitizeHtml separately before storage.
 */
export function validateText(
  input: string,
  opts: TextValidationOptions = {},
): ValidationResult {
  const { maxLength = 2000, minLength = 1, allowEmpty = false } = opts;
  const trimmed = input.trim();

  if (!allowEmpty && trimmed.length < minLength) {
    return { ok: false, error: 'Message is too short.' };
  }
  if (trimmed.length > maxLength) {
    return {
      ok: false,
      error: `Message exceeds the maximum length of ${maxLength} characters.`,
    };
  }
  return { ok: true };
}

/**
 * HTML entity map for escaping special characters.
 */
const HTML_ENTITY_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#x27;',
  '/': '&#x2F;',
  '`': '&#x60;',
  '=': '&#x3D;',
};

/**
 * Escapes HTML special characters to prevent XSS when rendering user content.
 * Use this when displaying any user-generated string in HTML context.
 */
export function escapeHtml(input: string): string {
  return input.replace(/[&<>"'`=/]/g, (char) => HTML_ENTITY_MAP[char] ?? char);
}

/**
 * Sanitizes HTML by:
 * 1. Removing <script>…</script> blocks (including multiline).
 * 2. Removing inline event handlers (onerror=, onclick=, onload=, etc.).
 * 3. Removing javascript: and data: href/src attributes.
 * 4. Removing <iframe>, <object>, <embed>, <form> tags entirely.
 * 5. Escaping remaining HTML entities.
 *
 * Content is stored as sanitized plain text — no raw HTML is kept.
 */
export function sanitizeHtml(input: string): string {
  let result = input;

  // Strip <script> blocks
  result = result.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script\s*>/gi, '');

  // Strip dangerous tags wholesale
  result = result.replace(/<\/?(iframe|object|embed|form|base|meta|link|style)\b[^>]*>/gi, '');

  // Remove inline event handlers (on*)
  result = result.replace(/\s*on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');

  // Remove javascript: and data: in href/src attributes
  result = result.replace(/(href|src|action)\s*=\s*["']?\s*(javascript|data|vbscript):[^"'\s>]*/gi, '');

  // Escape remaining HTML to plain text
  result = escapeHtml(result);

  return result;
}
