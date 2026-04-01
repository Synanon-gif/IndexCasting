/**
 * Input normalization utilities.
 * Run normalizeInput() BEFORE any validation to ensure consistent
 * inputs reach the validation layer — regardless of encoding tricks.
 *
 * Defenses:
 * - Removes zero-width / invisible Unicode chars used to bypass filters
 * - Normalizes Unicode to NFC (prevents homograph attacks via decomposed chars)
 * - Collapses excessive character repetition (spam detection aid)
 * - Trims surrounding whitespace
 */

/**
 * Unicode ranges for invisible / zero-width characters that carry no
 * visible content but can be used to break filter patterns.
 */
const INVISIBLE_CHAR_REGEX =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u00AD\u0600-\u0605\u061C\u06DD\u070F\u08E2\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF\uFFF9-\uFFFB]/g;

/**
 * Removes invisible and zero-width Unicode characters from a string.
 * Exported for targeted use when full normalization is not needed.
 */
export function stripInvisibleChars(input: string): string {
  return input.replace(INVISIBLE_CHAR_REGEX, '');
}

/**
 * Collapses runs of more than `max` identical characters to exactly `max`.
 * Example: "heeeeello" → "heeello" (max=3)
 * Prevents character-flooding spam.
 */
function collapseRepeatedChars(input: string, max = 3): string {
  return input.replace(/(.)\1{3,}/g, (_, char: string) => char.repeat(max));
}

/**
 * Normalizes user input before validation:
 * 1. Unicode NFC normalization (canonical decomposition → canonical composition)
 * 2. Strips invisible / zero-width characters
 * 3. Collapses excessive character repetition (>3 identical chars → 3)
 * 4. Trims surrounding whitespace
 *
 * Always call this before validateText(), validateUrl(), or storing any input.
 */
export function normalizeInput(input: string): string {
  if (typeof input !== 'string') return '';
  let result = input;
  // 1. Unicode normalization to canonical form
  if (result.normalize) {
    result = result.normalize('NFC');
  }
  // 2. Strip invisible characters
  result = stripInvisibleChars(result);
  // 3. Collapse spam repetition
  result = collapseRepeatedChars(result);
  // 4. Trim
  result = result.trim();
  return result;
}
