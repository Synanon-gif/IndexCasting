/**
 * Konsistente Aufteilung von profiles.display_name → Bewerbung first_name / last_name
 * (erstes Wort / Rest; einzelnes Wort → last_name leer).
 */
export function splitProfileDisplayName(displayName: string | null | undefined): {
  firstName: string;
  lastName: string;
} {
  const d = (displayName || '').trim().replace(/\s+/g, ' ');
  if (!d) return { firstName: '', lastName: '' };
  const i = d.indexOf(' ');
  if (i === -1) return { firstName: d, lastName: '' };
  return { firstName: d.slice(0, i).trim(), lastName: d.slice(i + 1).trim() };
}

export function normalizeNamePart(s: string): string {
  return s.trim().toLowerCase();
}
