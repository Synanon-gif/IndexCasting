/**
 * Booking brief: structured production fields in calendar_entries.booking_details.booking_brief.
 * Visibility is enforced in the app UI (same trust model as agency/client/model notes in JSON).
 */

export type BookingBriefPartyRole = 'client' | 'agency' | 'model';

export const BOOKING_BRIEF_FIELD_KEYS = [
  'shoot_details',
  'location',
  'contact',
  'call_time',
  'deliverables',
] as const;

export type BookingBriefFieldKey = (typeof BOOKING_BRIEF_FIELD_KEYS)[number];

export type BookingBriefFieldScope = 'shared' | BookingBriefPartyRole;

export type BookingBriefEntry = {
  scope: BookingBriefFieldScope;
  text: string;
};

/** At most one entry per field key — single source of truth. */
export type BookingBrief = Partial<Record<BookingBriefFieldKey, BookingBriefEntry>>;

export const BOOKING_BRIEF_MAX_TEXT = 4000;

const SCOPES: readonly BookingBriefFieldScope[] = ['shared', 'agency', 'client', 'model'];

function isValidScope(s: unknown): s is BookingBriefFieldScope {
  return typeof s === 'string' && (SCOPES as readonly string[]).includes(s);
}

/** Fields the viewer may see (shared, own private, or empty slot to add). */
export function getEditableBriefFieldKeys(
  brief: BookingBrief | null | undefined,
  role: BookingBriefPartyRole,
): BookingBriefFieldKey[] {
  return BOOKING_BRIEF_FIELD_KEYS.filter((key) => {
    const e = brief?.[key];
    if (!e) return true;
    return e.scope === 'shared' || e.scope === role;
  });
}

/** Brief entries visible to the given party (for read-only summary or editor seed). */
export function filterBriefForRole(
  brief: BookingBrief | null | undefined,
  role: BookingBriefPartyRole,
): BookingBrief {
  if (!brief) return {};
  const out: BookingBrief = {};
  for (const key of BOOKING_BRIEF_FIELD_KEYS) {
    const e = brief[key];
    if (!e || !e.text?.trim()) continue;
    if (e.scope === 'shared' || e.scope === role) {
      out[key] = { scope: e.scope, text: e.text.trim() };
    }
  }
  return out;
}

export type BookingBriefDraft = Partial<
  Record<BookingBriefFieldKey, { text: string; scope: BookingBriefFieldScope }>
>;

export function buildBookingBriefDraft(
  brief: BookingBrief | null | undefined,
  role: BookingBriefPartyRole,
): BookingBriefDraft {
  const draft: BookingBriefDraft = {};
  const keys = getEditableBriefFieldKeys(brief, role);
  for (const key of BOOKING_BRIEF_FIELD_KEYS) {
    if (!keys.includes(key)) continue;
    const e = brief?.[key];
    draft[key] = e?.text
      ? { text: e.text, scope: e.scope === 'shared' || e.scope === role ? e.scope : 'shared' }
      : { text: '', scope: 'shared' };
  }
  return draft;
}

/**
 * Merge editor draft into existing brief. Preserves other parties' private fields.
 * Only keys editable for `role` are updated; empty text removes that key.
 */
export function mergeBookingBriefFromEditor(
  existing: BookingBrief | null | undefined,
  draft: BookingBriefDraft,
  role: BookingBriefPartyRole,
): BookingBrief {
  const prev: BookingBrief = { ...(existing || {}) };
  const editable = new Set(getEditableBriefFieldKeys(existing, role));

  for (const key of BOOKING_BRIEF_FIELD_KEYS) {
    if (!editable.has(key)) continue;
    const d = draft[key];
    if (!d) continue;
    const t = d.text.trim();
    if (!t) {
      delete prev[key];
      continue;
    }
    let scope: BookingBriefFieldScope = d.scope;
    if (scope !== 'shared' && scope !== role) {
      scope = 'shared';
    }
    prev[key] = { scope, text: t.slice(0, BOOKING_BRIEF_MAX_TEXT) };
  }
  return prev;
}

/** Parse JSON sub-tree from booking_details (tolerates unknown shapes). */
export function parseBookingBrief(raw: unknown): BookingBrief | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const o = raw as Record<string, unknown>;
  const out: BookingBrief = {};
  for (const key of BOOKING_BRIEF_FIELD_KEYS) {
    const v = o[key];
    if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
    const rec = v as Record<string, unknown>;
    if (!isValidScope(rec.scope)) continue;
    const text = typeof rec.text === 'string' ? rec.text : '';
    const trimmed = text.trim();
    if (!trimmed) continue;
    out[key] = {
      scope: rec.scope as BookingBriefFieldScope,
      text: trimmed.slice(0, BOOKING_BRIEF_MAX_TEXT),
    };
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
