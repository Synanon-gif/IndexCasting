/**
 * Regression guard: kein Code in src/ darf hardcoded Strings 'Client', 'Agency'
 * oder 'Model' als Fallback (||, ??) für Org-/Personennamen verwenden.
 *
 * Hintergrund (siehe `.cursorrules` §28.1 + Migration 20260923):
 * Org-Namen kommen aus der DB (`organizations.company_name` / Trigger-gepflegte
 * Mirror-Felder) bzw. aus `uiCopy.common.unknownClient` / `unknownAgency` als
 * letzter Fallback. Literal-Strings wie `|| 'Client'` würden den DB-Trigger
 * unterlaufen und wieder Platzhalter rendern.
 *
 * Erlaubte Ausnahmen sind im ALLOWLIST-Set definiert: Dateien, in denen
 * 'Client' / 'Agency' / 'Model' bewusst als ROLLEN-Label (nicht Org-Name)
 * verwendet wird (Admin-Dashboard, Auth-Screens, Sender-Role-Label).
 */

import * as fs from 'fs';
import * as path from 'path';

const SRC_DIR = path.resolve(__dirname, '../../');

/** Datei-Pfade (relativ zu src/) die bewusst die Wörter als Rollen-Label nutzen. */
const ALLOWLIST = new Set<string>([
  'constants/uiCopy.ts', // Definiert die Strings
  'utils/messengerSenderLabel.ts', // Generic role label "Name (Role)"
  'screens/AuthScreen.tsx', // Sign-up Rollen-Wahl
  'screens/PendingActivationScreen.tsx', // Rollen-Anzeige
  'web/AdminDashboard.tsx', // Org-Typ-Klassifikation
  'utils/modelOptionDisplay.ts', // Enthält PLACEHOLDER_NAMES Set (definiert die Filter)
  'services/calendarSupabase.ts', // Enthält PLACEHOLDER_NAMES_LC Set (definiert die Filter)
  'components/UnifiedCalendarAgenda.tsx', // Enthält PLACEHOLDER_NAMES_LC Set
]);

/** Patterns die einen hardcoded Org-Namen-Fallback signalisieren. */
const FORBIDDEN_PATTERNS: RegExp[] = [
  /\|\|\s*['"]Client['"]/,
  /\?\?\s*['"]Client['"]/,
  /\|\|\s*['"]Agency['"]/,
  /\?\?\s*['"]Agency['"]/,
  /\|\|\s*['"]Model['"]/,
  /\?\?\s*['"]Model['"]/,
];

/** Recursive walk durch src/ — sammelt alle .ts/.tsx Dateien (außer Tests). */
function collectSourceFiles(dir: string, acc: string[] = []): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      collectSourceFiles(full, acc);
    } else if (entry.isFile()) {
      if (entry.name.endsWith('.test.ts') || entry.name.endsWith('.test.tsx')) continue;
      if (!entry.name.endsWith('.ts') && !entry.name.endsWith('.tsx')) continue;
      acc.push(full);
    }
  }
  return acc;
}

describe('Org-Name Placeholder Guard (Regression)', () => {
  it('Kein src/-Code (außer Allowlist) verwendet hardcoded Client/Agency/Model als ||/?? Fallback', () => {
    const files = collectSourceFiles(SRC_DIR);
    const violations: { file: string; line: number; content: string; pattern: string }[] = [];

    for (const file of files) {
      const relPath = path.relative(SRC_DIR, file).replace(/\\/g, '/');
      if (ALLOWLIST.has(relPath)) continue;

      const content = fs.readFileSync(file, 'utf8');
      const lines = content.split('\n');
      lines.forEach((line, idx) => {
        // Ignoriere Kommentar-Zeilen
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;

        for (const pattern of FORBIDDEN_PATTERNS) {
          if (pattern.test(line)) {
            violations.push({
              file: relPath,
              line: idx + 1,
              content: trimmed,
              pattern: pattern.source,
            });
          }
        }
      });
    }

    if (violations.length > 0) {
      const msg = violations
        .map((v) => `  ${v.file}:${v.line}\n    Pattern: ${v.pattern}\n    Code:    ${v.content}`)
        .join('\n\n');
      throw new Error(
        `Found ${violations.length} hardcoded 'Client'/'Agency'/'Model' fallback(s).\n` +
          `Use uiCopy.common.unknownClient / unknownAgency / unknownModel instead, ` +
          `or add the file to ALLOWLIST in this test if it is a legitimate role-label usage.\n\n` +
          `Violations:\n${msg}`,
      );
    }

    expect(violations).toEqual([]);
  });
});
