/**
 * Policy: `calendarEntryColor()` maps raw `entry_type` → hex only. Calendar **blocks** (month dot,
 * week chip, day segment, model agenda) must use `getCalendarEntryBlockColor` or projection badges
 * from `calendarProjectionLabel.ts` so Job titles and lifecycle stay aligned with the legend.
 *
 * This test fails on accidental reintroduction of `calendarEntryColor` imports in app code.
 */
import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const SRC = path.join(REPO_ROOT, 'src');

function walkTsFiles(dir: string, out: string[]): void {
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === 'dist' || name === '.expo') continue;
      walkTsFiles(full, out);
    } else if (/\.(ts|tsx)$/.test(name)) {
      out.push(full);
    }
  }
}

function isTestPath(p: string): boolean {
  return p.includes(`${path.sep}__tests__${path.sep}`) || /\.test\.(ts|tsx)$/.test(p);
}

function findCalendarEntryColorViolations(source: string): { line: number; snippet: string }[] {
  const out: { line: number; snippet: string }[] = [];
  const re =
    /\bimport\s+(?:type\s+)?(?:\{[\s\S]*?\bcalendarEntryColor\b[\s\S]*?\}|\bcalendarEntryColor\b)\s+from\s+['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const fromPath = m[1];
    if (!fromPath.includes('calendarColors')) continue;
    const start = m.index;
    const line = source.slice(0, start).split(/\n/).length;
    const raw = m[0].trim();
    const snippet = raw.length > 120 ? `${raw.slice(0, 117)}…` : raw;
    out.push({ line, snippet });
  }
  return out;
}

describe('calendar color import policy', () => {
  it('does not import calendarEntryColor in production code (use getCalendarEntryBlockColor / projection)', () => {
    const files: string[] = [];
    walkTsFiles(SRC, files);
    const bad: { file: string; line: number; text: string }[] = [];

    for (const file of files) {
      const norm = path.normalize(file);
      if (isTestPath(norm)) continue;

      const text = fs.readFileSync(file, 'utf8');
      for (const v of findCalendarEntryColorViolations(text)) {
        bad.push({ file: norm, line: v.line, text: v.snippet });
      }
    }

    if (bad.length) {
      const msg = bad
        .map(
          (b) =>
            `${b.file}:${b.line} — ${b.text}\n  → use getCalendarEntryBlockColor from calendarProjectionLabel, or projection helpers.`,
        )
        .join('\n');
      throw new Error(
        `Forbidden import of calendarEntryColor in application code:\n\n${msg}\n\nSee .cursor/rules/calendar-colors-single-source.mdc`,
      );
    }
  });
});
