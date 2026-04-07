#!/usr/bin/env node
/**
 * Generiert CHATGPT_FULL_PROJECT_EXPORT_*.txt + CHATGPT_EXPORT_MANIFEST.txt
 * Keine Code-Änderungen am App-Code — nur lesen, redigieren, schreiben.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const MAX_PART_BYTES = 2_400_000; // ~2,3 MB pro Teil (Upload-freundlich)

const ALLOWED_EXT = new Set([
  '.ts',
  '.tsx',
  '.sql',
  '.md',
  '.mdc',
  '.yml',
  '.yaml',
  '.json',
  '.toml',
  '.html',
  '.cjs',
  '.mjs',
  '.sh',
  '.txt',
  '.css',
]);

const SKIP_DIR_NAMES = new Set([
  'node_modules',
  '.git',
  'dist',
  'web-build',
  '.expo',
  'test-results',
  'playwright-report',
  'blob-report',
  'ios',
  'android',
  'coverage',
]);

const SKIP_FILE_NAMES = new Set(['package-lock.json', 'PROJECT_CONTEXT_FOR_CHATGPT.txt']);

/** Reihenfolge = Priorität laut Aufgabe */
const SECTIONS = [
  { dir: 'supabase/migrations', category: 'migration' },
  { dir: 'supabase/functions', category: 'function' },
  { dir: 'src/context', category: 'context' },
  { dir: 'src/services', category: 'service' },
  { dir: 'src/views', category: 'view' },
  { dir: 'src/screens', category: 'view' },
  { dir: 'src/components', category: 'component' },
  { dir: 'src/types', category: 'type' },
  { dir: 'src/utils', category: 'util' },
  { dir: 'src/constants', category: 'config' },
  { dir: 'src/config', category: 'config' },
  { dir: 'src/storage', category: 'storage' },
  { dir: 'src/navigation', category: 'navigation' },
  { dir: 'src/db', category: 'db' },
  { dir: 'lib', category: 'lib' },
  { dir: 'e2e', category: 'test' },
  { dir: 'docs', category: 'docs' },
  { dir: '.cursor/rules', category: 'docs' },
  { dir: '.github/workflows', category: 'docs' },
];

const ROOT_FILES = [
  { rel: 'App.tsx', category: 'entry' },
  { rel: 'index.ts', category: 'entry' },
  { rel: 'index.html', category: 'entry' },
  { rel: 'package.json', category: 'config' },
  { rel: 'playwright.config.ts', category: 'test' },
  { rel: 'vercel.json', category: 'config' },
  { rel: 'tsconfig.json', category: 'config' },
  { rel: 'jest.config.cjs', category: 'test' },
  { rel: 'capacitor.config.ts', category: 'config' },
  { rel: '.cursorrules', category: 'docs' },
  { rel: '.env.example', category: 'config' },
  { rel: 'supabase/config.toml', category: 'config' },
];

function shouldSkipPath(absPath) {
  const parts = absPath.split(path.sep);
  for (const p of parts) {
    if (SKIP_DIR_NAMES.has(p)) return true;
  }
  const base = path.basename(absPath);
  if (base.startsWith('.env')) return true;
  if (SKIP_FILE_NAMES.has(base)) return true;
  return false;
}

function isAllowedFile(absPath) {
  const base = path.basename(absPath);
  if (base.startsWith('CHATGPT_FULL_PROJECT_EXPORT_')) return false;
  if (base === 'CHATGPT_EXPORT_MANIFEST.txt') return false;
  const ext = path.extname(absPath).toLowerCase();
  if (!ALLOWED_EXT.has(ext)) return false;
  if (shouldSkipPath(absPath)) return false;
  return true;
}

function walkFilesRecursive(dirAbs, out) {
  if (!fs.existsSync(dirAbs)) return;
  let entries;
  try {
    entries = fs.readdirSync(dirAbs, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    const full = path.join(dirAbs, ent.name);
    if (shouldSkipPath(full)) continue;
    if (ent.isDirectory()) {
      if (SKIP_DIR_NAMES.has(ent.name)) continue;
      walkFilesRecursive(full, out);
    } else if (ent.isFile() && isAllowedFile(full)) {
      out.push(full);
    }
  }
}

function collectTestDirs(out) {
  function walk(dirAbs) {
    if (!fs.existsSync(dirAbs)) return;
    const entries = fs.readdirSync(dirAbs, { withFileTypes: true });
    for (const ent of entries) {
      const full = path.join(dirAbs, ent.name);
      if (shouldSkipPath(full)) continue;
      if (ent.isDirectory()) {
        if (ent.name === '__tests__') {
          walkFilesRecursive(full, out);
        } else {
          walk(full);
        }
      }
    }
  }
  walk(path.join(ROOT, 'src'));
  walk(path.join(ROOT, 'lib'));
}

/** Zusätzliche SQL unter supabase/ außerhalb migrations/ (RLS-Review) */
function collectSupabaseRootSql(out) {
  const supabaseRoot = path.join(ROOT, 'supabase');
  if (!fs.existsSync(supabaseRoot)) return;
  const entries = fs.readdirSync(supabaseRoot, { withFileTypes: true });
  for (const ent of entries) {
    if (!ent.isFile() || !ent.name.endsWith('.sql')) continue;
    const full = path.join(supabaseRoot, ent.name);
    if (isAllowedFile(full)) out.push({ abs: full, category: 'migration_supabase_root' });
  }
}

function redact(content) {
  let t = content;
  // JWT
  t = t.replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED_SECRET]');
  // Stripe
  t = t.replace(/\bsk_(live|test)_[A-Za-z0-9]+\b/g, '[REDACTED_SECRET]');
  t = t.replace(/\bpk_(live|test)_[A-Za-z0-9]+\b/g, '[REDACTED_SECRET]');
  t = t.replace(/\brk_live_[A-Za-z0-9]+\b/g, '[REDACTED_SECRET]');
  t = t.replace(/\brk_test_[A-Za-z0-9]+\b/g, '[REDACTED_SECRET]');
  // Supabase-style tokens
  t = t.replace(/\bsb_(secret|service_role|publishable|anon)_[A-Za-z0-9]+\b/gi, '[REDACTED_SECRET]');
  t = t.replace(/\bsbp_[A-Za-z0-9]+\b/g, '[REDACTED_SECRET]');
  // Authorization Bearer
  t = t.replace(/Bearer\s+[A-Za-z0-9._\-~+/]+=*/gi, 'Bearer [REDACTED_SECRET]');
  // Common key assignments (string)
  t = t.replace(
    /\b(api[_-]?key|apikey|secret|password|token|access[_-]?token|refresh[_-]?token|client[_-]?secret)\s*[:=]\s*['"`][^'"`]{6,}['"`]/gi,
    '$1=[REDACTED_SECRET]',
  );
  // Env-style lines in .md examples
  t = t.replace(
    /^(\s*(?:export\s+)?[A-Z0-9_]*(KEY|TOKEN|SECRET|PASSWORD)[A-Z0-9_]*\s*=\s*).+$/gim,
    '$1[REDACTED_SECRET]',
  );
  return t;
}

function relPath(abs) {
  return path.relative(ROOT, abs).split(path.sep).join('/');
}

function main() {
  const timestamp = new Date().toISOString();
  const orderedEntries = []; // { abs, category }

  const seen = new Set();

  for (const { dir, category } of SECTIONS) {
    const absDir = path.join(ROOT, dir);
    const batch = [];
    walkFilesRecursive(absDir, batch);
    batch.sort();
    for (const abs of batch) {
      const r = relPath(abs);
      if (seen.has(r)) continue;
      seen.add(r);
      orderedEntries.push({ abs, rel: r, category });
    }
  }

  // Tests (__tests__) — zusätzlich zu e2e / jest in ROOT_FILES
  const testBatch = [];
  collectTestDirs(testBatch);
  testBatch.sort();
  for (const abs of testBatch) {
    const r = relPath(abs);
    if (seen.has(r)) continue;
    seen.add(r);
    orderedEntries.push({ abs, rel: r, category: 'test' });
  }

  // supabase/*.sql (nicht migrations/)
  const sqlExtra = [];
  collectSupabaseRootSql(sqlExtra);
  sqlExtra.sort((a, b) => a.abs.localeCompare(b.abs));
  for (const { abs, category } of sqlExtra) {
    const r = relPath(abs);
    if (seen.has(r)) continue;
    seen.add(r);
    orderedEntries.push({ abs, rel: r, category });
  }

  // Root-Dateien
  for (const { rel, category } of ROOT_FILES) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs) || !isAllowedFile(abs)) continue;
    if (seen.has(rel)) continue;
    seen.add(rel);
    orderedEntries.push({ abs, rel, category });
  }

  const fileBlocks = [];
  const riskSource = []; // { rel } für Stichwort-Scan auf unredigiertem Text
  for (const { abs, rel, category } of orderedEntries) {
    let raw;
    try {
      raw = fs.readFileSync(abs, 'utf8');
    } catch {
      continue;
    }
    if (/\.(ts|tsx|sql|md|mdc)$/i.test(rel)) {
      riskSource.push({ rel, raw });
    }
    const body = redact(raw);
    const block =
      `\n================================================================================\n` +
      `FILE: ${rel}\n` +
      `================================================================================\n` +
      body +
      (body.endsWith('\n') ? '' : '\n');
    fileBlocks.push({ rel, category, block, bytes: Buffer.byteLength(block, 'utf8') });
  }

  const headerTemplate = (part, total) =>
    `================================================================================\n` +
    `INDEXCASTING — FULL PROJECT EXPORT\n` +
    `PART ${part} OF ${total}\n` +
    `GENERATED: ${timestamp}\n` +
    `WARNING: secrets redacted\n` +
    `================================================================================\n`;

  const parts = [];
  let current = '';
  let currentBytes = 0;

  function flush() {
    if (current.length === 0) return;
    parts.push(current);
    current = '';
    currentBytes = 0;
  }

  for (const { block, bytes } of fileBlocks) {
    if (currentBytes + bytes > MAX_PART_BYTES && currentBytes > 0) {
      flush();
    }
    current += block;
    currentBytes += bytes;
  }
  flush();

  if (parts.length === 0) {
    parts.push('\n(Keine exportierbaren Dateien gefunden.)\n');
  }

  const totalParts = parts.length;
  const exportFiles = [];

  for (let i = 0; i < totalParts; i++) {
    const name = `CHATGPT_FULL_PROJECT_EXPORT_${String(i + 1).padStart(2, '0')}.txt`;
    const content = headerTemplate(i + 1, totalParts) + parts[i];
    fs.writeFileSync(path.join(ROOT, name), content, 'utf8');
    exportFiles.push(name);
  }

  const excludedReasons = [
    'node_modules/** — Dependencies, nicht Quellkontext',
    '.git/** — Versionskontrolle',
    'dist/, web-build/, .expo/ — Build-Artefakte',
    'ios/, android/ — native Build-Ordner (generiert / groß)',
    '.env, .env.* — Secrets (nie exportieren)',
    'package-lock.json — sehr groß, redundant zu package.json',
    'Bilder (.png, .jpg, …), Fonts, PDF, Video — binär / nicht textuell',
    'src/providers/** — Verzeichnis existiert nicht in diesem Repo',
    'PROJECT_CONTEXT_FOR_CHATGPT.txt — älteres Bundle, nicht Teil dieses Exports',
    'CHATGPT_FULL_PROJECT_EXPORT_*.txt, CHATGPT_EXPORT_MANIFEST.txt — Export-Ausgaben selbst',
  ];

  const exportedRelSet = new Set(fileBlocks.map((f) => f.rel));
  const riskHints = riskSource
    .filter(({ raw }) =>
      /\b(EXPLOIT|VULN|SECURITY\s+AUDIT|FIXME\s*:\s*security|TODO\s*:\s*security)\b/i.test(raw),
    )
    .slice(0, 20)
    .map(({ rel }) => rel);

  const manifestLines = [];
  manifestLines.push('CHATGPT_EXPORT_MANIFEST');
  manifestLines.push(`GENERATED: ${timestamp}`);
  manifestLines.push('');
  manifestLines.push('=== 1. EXPORTIERTE DATEIEN (mit Kategorie) ===');
  for (const e of orderedEntries) {
    if (exportedRelSet.has(e.rel)) {
      manifestLines.push(`- [${e.category}] ${e.rel}`);
    }
  }

  manifestLines.push('');
  manifestLines.push('=== 2. AUSGELASSENE DATEIEN / MUSTER + GRUND ===');
  for (const line of excludedReasons) {
    manifestLines.push(`- ${line}`);
  }

  manifestLines.push('');
  manifestLines.push('=== 3. ARCHITEKTUR-KURZINDEX ===');
  manifestLines.push('Einstiegspunkte:');
  manifestLines.push('- App.tsx, index.ts, index.html');
  manifestLines.push('- src/navigation/RootNavigator.tsx (falls vorhanden)');
  manifestLines.push('');
  manifestLines.push('Auth / Session:');
  manifestLines.push('- src/context/AuthContext.tsx');
  manifestLines.push('- lib/supabase.ts');
  manifestLines.push('- src/config/env.ts');
  manifestLines.push('');
  manifestLines.push('Org / Rollen:');
  manifestLines.push('- src/types/roles.ts');
  manifestLines.push('- src/utils/orgGuard.ts');
  manifestLines.push('- src/services/organizationsInvitationsSupabase.ts');
  manifestLines.push('');
  manifestLines.push('Supabase / RPC / Client:');
  manifestLines.push('- lib/supabase.ts');
  manifestLines.push('- src/services/*Supabase.ts');
  manifestLines.push('- supabase/migrations/*.sql');
  manifestLines.push('');
  manifestLines.push('Upload / Consent:');
  manifestLines.push('- src/services/gdprComplianceSupabase.ts');
  manifestLines.push('- src/constants/uiCopy.ts (chatFileRights*)');
  manifestLines.push('');
  manifestLines.push('Booking / Option:');
  manifestLines.push('- src/services/optionRequestsSupabase.ts');
  manifestLines.push('- src/services/bookingEventsSupabase.ts');
  manifestLines.push('');
  manifestLines.push('Admin:');
  manifestLines.push('- src/services/adminSupabase.ts');
  manifestLines.push('- src/views/AdminDashboard.tsx');
  manifestLines.push('');

  manifestLines.push('=== 4. BEKANNTE RISIKO-/AUDIT-HINWEISE (Stichworte in exportierten Dateien) ===');
  if (riskHints.length === 0) {
    manifestLines.push('- (keine Treffer auf EXPLOIT/VULN/SECURITY AUDIT in den ersten Filtern — manuell SQL/RLS prüfen)');
  } else {
    for (const r of riskHints) {
      manifestLines.push(`- ${r}`);
    }
  }

  manifestLines.push('');
  manifestLines.push('=== 5. STATISTIK ===');
  manifestLines.push(`Exportierte Dateien: ${fileBlocks.length}`);
  manifestLines.push(`Ausgelassene Muster: ${excludedReasons.length} (Kategorien, keine Einzeldateiliste)`);
  manifestLines.push(`Erzeugte Export-Teile: ${totalParts} (${exportFiles.join(', ')})`);

  fs.writeFileSync(path.join(ROOT, 'CHATGPT_EXPORT_MANIFEST.txt'), manifestLines.join('\n') + '\n', 'utf8');

  console.log('OK:', exportFiles.join(', '), '+ CHATGPT_EXPORT_MANIFEST.txt');
  console.log('Dateien:', fileBlocks.length, 'Teile:', totalParts);
}

main();
