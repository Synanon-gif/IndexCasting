/**
 * Central character limits for client-side validation and clamping.
 * Defense-in-depth — server/DB remain authoritative.
 */

/** Chat / messenger / recruiting message body (matches validateText default). */
export const MESSAGE_MAX_LENGTH = 2000;

/** Shared booking notes in calendar_entries.booking_details.shared_notes[].text */
export const SHARED_BOOKING_NOTE_MAX_LENGTH = 4000;

/** Model display name — client clamp before RPC (aligns with typical varchar headroom). */
export const MODEL_NAME_MAX_LENGTH = 120;

/** City / location free text — client clamp before RPC */
export const MODEL_CITY_MAX_LENGTH = 200;

/** Short descriptive fields (hair, eyes, ethnicity, current_location line) */
export const MODEL_SHORT_TEXT_MAX_LENGTH = 200;

/** Client-only guard against rapid double-submit (chat, shared notes, etc.) — not server rate limiting. */
export const UI_DOUBLE_SUBMIT_DEBOUNCE_MS = 400;
