#!/usr/bin/env node
/**
 * Deterministic repo audit: git ls-files manifest + SHA256 + gate results + rule scans.
 * Also: TS dependency graph, export map / import usage, rule-engine for supabase.from,
 * drift vs docs/AUDIT_DRIFT_BASELINE.json (update with AUDIT_WRITE_BASELINE=1).
 *
 * Optional env:
 *   AUDIT_WRITE_BASELINE=1     — write docs/AUDIT_DRIFT_BASELINE.json after run (commit when intentional)
 *   AUDIT_FAIL_ON_DRIFT=1      — exit 1 if drift or new forbidden supabase.from vs baseline
 *   AUDIT_CI_ENFORCE=1         — exit 1 on: missing drift baseline, prod void…catch, storage upload outside allowlist
 *   AUDIT_FAIL_ON_ANY_FORBIDDEN=1 — exit 1 if any forbidden supabase.from remains (strict; optional)
 *
 * Writes docs/AUDIT_COVERAGE_MANIFEST_<ISO_DATE>.{md,json} and docs/SYSTEM_AUDIT_REPORT_<ISO_DATE>.md
 */
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, extname, dirname, normalize } from 'node:path';
import { execSync, spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
/** @type {typeof import('typescript')} */
const ts = require('typescript');

const REPO_ROOT = join(import.meta.dirname, '..');
const DRIFT_BASELINE_PATH = join(REPO_ROOT, 'docs', 'AUDIT_DRIFT_BASELINE.json');

/** Exclude generated audit outputs from drift fingerprints (otherwise every run looks like churn). */
function isGeneratedAuditArtifact(relPath) {
  const p = relPath.replace(/\\/g, '/');
  if (p === 'docs/AUDIT_DRIFT_BASELINE.json') return true;
  if (p === 'docs/AUDIT_DEPENDENCY_GRAPH.json') return true;
  if (p === 'docs/AUDIT_EXPORT_MAP.json') return true;
  if (/^docs\/AUDIT_COVERAGE_MANIFEST_\d{4}-\d{2}-\d{2}\.(md|json)$/.test(p)) return true;
  if (/^docs\/SYSTEM_AUDIT_REPORT_\d{4}-\d{2}-\d{2}\.md$/.test(p)) return true;
  return false;
}

const CRITICAL_PATH_PREFIXES = [
  'src/context/',
  'src/services/',
  'lib/',
  'supabase/migrations/',
  'src/web/',
  'App.tsx',
];
const ISO_DATE = new Date().toISOString().slice(0, 10);
const OUT_MD = join(REPO_ROOT, 'docs', `AUDIT_COVERAGE_MANIFEST_${ISO_DATE}.md`);
const OUT_JSON = join(REPO_ROOT, 'docs', `AUDIT_COVERAGE_MANIFEST_${ISO_DATE}.json`);
const OUT_REPORT = join(REPO_ROOT, 'docs', `SYSTEM_AUDIT_REPORT_${ISO_DATE}.md`);
const OUT_DEP_GRAPH = join(REPO_ROOT, 'docs', 'AUDIT_DEPENDENCY_GRAPH.json');
const OUT_EXPORT_MAP = join(REPO_ROOT, 'docs', 'AUDIT_EXPORT_MAP.json');

const BINARY_EXT = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
  '.pdf',
  '.zip',
  '.woff',
  '.woff2',
]);

function getCategory(relPath) {
  const p = relPath.replace(/\\/g, '/');
  const parts = p.split('/');
  if (parts[0] === 'src' && parts[1]) {
    return `src_${parts[1]}`;
  }
  if (p.startsWith('lib/')) return 'lib';
  if (p.startsWith('supabase/migrations/')) return 'supabase_migrations';
  if (p.startsWith('supabase/functions/')) return 'supabase_functions';
  if (p.startsWith('supabase/')) return 'supabase_other';
  if (p.startsWith('.cursor/rules/')) return 'cursor_rules';
  if (p.startsWith('.cursor/')) return 'cursor_other';
  if (p.startsWith('.github/')) return 'github';
  if (p.startsWith('e2e/')) return 'e2e';
  if (p.startsWith('scripts/')) return 'scripts';
  if (p.startsWith('docs/')) return 'docs';
  if (p.startsWith('assets/')) return 'assets';
  return 'root';
}

function getFileKind(relPath) {
  const ext = extname(relPath).toLowerCase();
  if (BINARY_EXT.has(ext)) return 'binary';
  if (ext === '.md' || ext === '.html') return 'doc';
  if (ext === '.sql') return 'sql';
  if (['.ts', '.tsx', '.js', '.cjs', '.mjs'].includes(ext)) return 'code';
  if (['.json', '.yml', '.yaml', '.toml'].includes(ext)) return 'config';
  if (ext === '.mdc') return 'governance';
  return 'other';
}

function defaultPurpose(relPath, category, fileKind) {
  if (fileKind === 'binary') return 'Static asset (no semantic code review).';
  if (relPath.startsWith('supabase/migrations/')) return 'Canonical DB migration.';
  if (relPath.startsWith('supabase/') && relPath.endsWith('.sql')) return 'SQL (legacy or reference; live DB follows migrations/).';
  if (relPath.startsWith('supabase/functions/')) return 'Supabase Edge Function entry.';
  if (category === 'src_services') return 'Service layer / Supabase integration.';
  if (category.startsWith('src_')) return `Application ${category.replace('src_', '')} module.`;
  if (category === 'lib') return 'Shared library (Supabase client, validation).';
  if (category === 'docs') return 'Documentation / audit reference.';
  if (category === 'cursor_rules') return 'Cursor governance rules.';
  return 'Repository file.';
}

function sha256File(absPath) {
  try {
    const buf = readFileSync(absPath);
    return createHash('sha256').update(buf).digest('hex');
  } catch {
    return null;
  }
}

function gitLsFiles() {
  const out = execSync('git ls-files', { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });
  return out
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

function inEslintScope(relPath) {
  return (
    (relPath.startsWith('src/') && /\.(ts|tsx)$/.test(relPath)) ||
    (relPath.startsWith('lib/') && /\.(ts|tsx)$/.test(relPath))
  );
}

function inTypecheckScope(relPath) {
  if (relPath.startsWith('e2e/')) return false;
  if (relPath.startsWith('supabase/functions/')) return false;
  if (relPath === 'playwright.config.ts') return false;
  return /\.(ts|tsx)$/.test(relPath) && !relPath.startsWith('node_modules/');
}

function runGate(cmd, args, cwd) {
  const r = spawnSync(cmd, args, {
    cwd: cwd || REPO_ROOT,
    encoding: 'utf8',
    shell: false,
    maxBuffer: 20 * 1024 * 1024,
  });
  return {
    ok: r.status === 0,
    status: r.status,
    stdout: (r.stdout || '').slice(-8000),
    stderr: (r.stderr || '').slice(-8000),
  };
}

/** @type {{ path: string, line: number, classification: string, rule_id: string, note: string }[]} */
const SUPABASE_FROM_RULE_HITS = [];

/** Forbidden-only (backward compat with report tables) */
const UI_SUPABASE_FROM = [];

// ─── A: Dependency graph + B: exports / usage ───────────────────────────────

/** @type {Record<string, string[]>} adjacency: fromRelPath -> [toRelPath, ...] */
const DEP_GRAPH = {};

/** @type {{ file: string, name: string, line: number, kind: string }[]} */
const EXPORTED_SYMBOLS = [];

/** @type {{ exportKey: string, file: string, name: string, importers: { file: string, names: string[] }[] }[]} */
const EXPORT_USAGE_SUMMARY = [];

function isCriticalPath(relPath) {
  return CRITICAL_PATH_PREFIXES.some((p) => relPath === p || relPath.startsWith(p));
}

/**
 * Resolve relative or package-internal spec from fromFile to repo-relative path or null.
 */
function resolveInternalModule(fromRel, specifier) {
  if (!specifier || (!specifier.startsWith('.') && !specifier.startsWith('/'))) {
    return null;
  }
  const base = join(REPO_ROOT, dirname(fromRel));
  let resolved = normalize(join(base, specifier)).replace(/\\/g, '/');
  const rootNorm = REPO_ROOT.replace(/\\/g, '/');
  if (!resolved.startsWith(rootNorm)) return null;
  let rel = resolved.slice(rootNorm.length + 1);
  const exts = ['', '.ts', '.tsx', '.js', '.cjs', '.mjs'];
  for (const ext of exts) {
    const cand = ext ? `${rel}${ext}` : rel;
    if (existsSync(join(REPO_ROOT, cand))) return cand;
  }
  for (const ext of ['.ts', '.tsx']) {
    const cand = `${rel}/index${ext}`;
    if (existsSync(join(REPO_ROOT, cand))) return cand;
  }
  return null;
}

function hasModifier(node, kind) {
  return !!node.modifiers?.some((m) => m.kind === kind);
}

function collectFromSourceFile(relPath, sf) {
  const edges = new Set();
  const exports = [];
  const importEdges = [];

  function addEdge(to) {
    if (to && to !== relPath) edges.add(to);
  }

  function visit(node) {
    if (ts.isImportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const spec = node.moduleSpecifier.text;
      const to = resolveInternalModule(relPath, spec);
      if (to) {
        addEdge(to);
        const names = [];
        const cl = node.importClause;
        if (cl) {
          if (cl.name) names.push(cl.name.text);
          if (cl.namedBindings) {
            if (ts.isNamespaceImport(cl.namedBindings)) names.push(`*as:${cl.namedBindings.name.text}`);
            else if (ts.isNamedImports(cl.namedBindings)) {
              for (const el of cl.namedBindings.elements) names.push(el.name.text);
            }
          }
        }
        importEdges.push({ from: relPath, to, names, isTypeOnly: !!cl?.isTypeOnly });
      }
    }

    if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const to = resolveInternalModule(relPath, node.moduleSpecifier.text);
      if (to) addEdge(to);
      // Names are re-exported from `to`, not defined in this file — omit from local export inventory.
    }

    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const arg0 = node.arguments[0];
      if (arg0 && ts.isStringLiteral(arg0)) {
        const to = resolveInternalModule(relPath, arg0.text);
        if (to) addEdge(to);
      }
    }

    if (ts.isFunctionDeclaration(node) && node.name && hasModifier(node, ts.SyntaxKind.ExportKeyword)) {
      exports.push({ name: node.name.text, line: sf.getLineAndCharacterOfPosition(node.getStart()).line + 1, kind: 'function' });
    }

    if (ts.isClassDeclaration(node) && node.name && hasModifier(node, ts.SyntaxKind.ExportKeyword)) {
      exports.push({ name: node.name.text, line: sf.getLineAndCharacterOfPosition(node.getStart()).line + 1, kind: 'class' });
    }

    if (ts.isVariableStatement(node) && hasModifier(node, ts.SyntaxKind.ExportKeyword)) {
      for (const d of node.declarationList.declarations) {
        if (ts.isIdentifier(d.name)) {
          const isFn =
            d.initializer &&
            (ts.isArrowFunction(d.initializer) ||
              ts.isFunctionExpression(d.initializer) ||
              (ts.isCallExpression(d.initializer) && ts.isFunctionExpression(d.initializer.expression)));
          exports.push({
            name: d.name.text,
            line: sf.getLineAndCharacterOfPosition(d.getStart()).line + 1,
            kind: isFn ? 'const_fn' : 'const',
          });
        }
      }
    }

    if (
      ts.isExportDeclaration(node) &&
      node.exportClause &&
      ts.isNamedExports(node.exportClause) &&
      !node.moduleSpecifier
    ) {
      for (const el of node.exportClause.elements) {
        const nm = (el.propertyName || el.name).text;
        exports.push({ name: nm, line: sf.getLineAndCharacterOfPosition(el.getStart()).line + 1, kind: 'export_specifier' });
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sf);
  return { edges: [...edges], exports, importEdges };
}

function parseAndAnalyzeTs(relPath, content) {
  const kind = relPath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(relPath, content, ts.ScriptTarget.Latest, true, kind);
  return collectFromSourceFile(relPath, sf);
}

/**
 * Rule engine: direct supabase.from( — not string matching alone; tied to rule ids.
 */
function classifySupabaseFromRules(relPath, content) {
  if (!/\.(tsx|ts)$/.test(relPath)) return;
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!/\bsupabase\s*\.\s*from\s*\(/.test(line)) continue;

    let classification;
    let rule_id;
    if (relPath.startsWith('src/context/AuthContext')) {
      classification = 'exception';
      rule_id = 'supabase_from_auth_context';
    } else if (relPath.startsWith('src/services/') || relPath.startsWith('lib/')) {
      classification = 'allowed';
      rule_id = 'supabase_from_service_layer';
    } else {
      classification = 'forbidden';
      rule_id = 'supabase_from_outside_service_layer';
    }

    const hit = {
      path: relPath,
      line: i + 1,
      classification,
      rule_id,
      note:
        classification === 'allowed'
          ? 'Direct table access in service/lib (allowed).'
          : classification === 'exception'
            ? 'Auth bootstrap path (documented exception).'
            : 'Prefer service-layer RPC/query helpers for org-scoped access.',
    };
    SUPABASE_FROM_RULE_HITS.push(hit);
    if (classification === 'forbidden') {
      UI_SUPABASE_FROM.push({
        path: relPath,
        pattern: 'supabase.from(',
        note: `line ${i + 1}: ${hit.note}`,
      });
    }
  }
}

/** @type {{ path: string, line: number, text: string }[]} */
const SNAPSHOT_PATTERNS = [];

function scanSnapshotOptimistic(relPath, content) {
  if (!/\.(tsx|ts)$/.test(relPath)) return;
  if (!/(ClientWebApp\.tsx|src\/views\/|src\/components\/)/.test(relPath)) return;
  const lines = content.split('\n');
  lines.forEach((line, i) => {
    if (/const\s+snapshot\s*=/.test(line)) {
      SNAPSHOT_PATTERNS.push({ path: relPath, line: i + 1, text: line.trim().slice(0, 120) });
    }
  });
}

/** void xxx().catch( — risky with Option-A services */
const VOID_CATCH = [];

/** supabase.storage usage outside upload-consent matrix service files (see .cursor/rules/upload-consent-matrix.mdc) */
const STORAGE_UPLOAD_RULE_VIOLATIONS = [];

/** Repo-relative paths allowed to call supabase.storage (aligned with upload-consent matrix). */
const STORAGE_UPLOAD_ALLOWLIST = new Set(
  [
    'src/services/modelPhotosSupabase.ts',
    'src/services/applicationsSupabase.ts',
    'src/services/recruitingChatSupabase.ts',
    'src/services/messengerSupabase.ts',
    'src/services/optionRequestsSupabase.ts',
    'src/services/documentsSupabase.ts',
    'src/services/verificationSupabase.ts',
  ].map((p) => p.replace(/\\/g, '/')),
);

/** True if file contains a chained `supabase.storage.from(…).upload(` (upload consent / matrix). */
function normalizedHasSupabaseStorageUpload(content) {
  const n = content.replace(/\s+/g, ' ');
  // `from(...)` arg must not contain `)` — rare edge case: `.from(fn())` would need a richer parser.
  return /\bsupabase\s*\.\s*storage\s*\.\s*from\s*\([^)]*\)\s*\.\s*upload\s*\(/.test(n);
}

function scanStorageUploadAllowlist(relPath, content) {
  const normPath = relPath.replace(/\\/g, '/');
  if (!normPath.startsWith('src/')) return;
  if (!/\.(tsx?)$/.test(normPath)) return;
  if (normPath.includes('__tests__')) return;
  if (STORAGE_UPLOAD_ALLOWLIST.has(normPath)) return;

  if (!normalizedHasSupabaseStorageUpload(content)) return;

  const lines = content.split('\n');
  let hitLine = 1;
  for (let i = 0; i < lines.length; i++) {
    if (/\bsupabase\s*\.\s*storage\b/.test(lines[i])) {
      hitLine = i + 1;
      break;
    }
  }
  STORAGE_UPLOAD_RULE_VIOLATIONS.push({
    path: normPath,
    line: hitLine,
    text: (lines[hitLine - 1] || '').trim().slice(0, 160),
    rule_id: 'storage_upload_outside_matrix_services',
  });
}

function scanVoidCatch(relPath, content) {
  if (!/\.(tsx|ts)$/.test(relPath)) return;
  if (!relPath.startsWith('src/')) return;
  const lines = content.split('\n');
  lines.forEach((line, i) => {
    if (/void\s+[\w.()]+\.then/.test(line)) return;
    if (/Linking\.openURL/.test(line)) return;
    if (/void\s+.+\.catch\s*\(/.test(line)) {
      VOID_CATCH.push({ path: relPath, line: i + 1, text: line.trim().slice(0, 160) });
    }
  });
}

function buildExportUsageIndex(tsFiles, perFileData) {
  /** @type {Map<string, Set<string>>} */
  const fileToExportNames = new Map();
  for (const rel of tsFiles) {
    const data = perFileData.get(rel);
    if (!data) continue;
    const set = new Set();
    for (const ex of data.exports) set.add(ex.name);
    fileToExportNames.set(rel, set);
  }

  /** @type {Map<string, { file: string, names: string[] }[]>} */
  const usageByTarget = new Map();
  for (const rel of tsFiles) {
    const data = perFileData.get(rel);
    if (!data) continue;
    for (const ie of data.importEdges) {
      if (ie.isTypeOnly) continue;
      for (const n of ie.names) {
        if (n.startsWith('*as:')) continue;
        const key = `${ie.to}::${n}`;
        if (!usageByTarget.has(key)) usageByTarget.set(key, []);
        const arr = usageByTarget.get(key);
        let block = arr.find((x) => x.file === rel);
        if (!block) {
          block = { file: rel, names: [] };
          arr.push(block);
        }
        if (!block.names.includes(n)) block.names.push(n);
      }
    }
  }

  for (const [target, expNames] of fileToExportNames) {
    for (const name of expNames) {
      const key = `${target}::${name}`;
      const importers = usageByTarget.get(key) || [];
      if (importers.length === 0) continue;
      EXPORT_USAGE_SUMMARY.push({
        exportKey: key,
        file: target,
        name,
        importers,
      });
    }
  }
}

function scanAllTsRoots() {
  const all = gitLsFiles();
  const uniq = [
    ...new Set(
      all.filter(
        (p) => /\.(ts|tsx)$/.test(p) && (p.startsWith('src/') || p.startsWith('lib/')),
      ),
    ),
  ].sort();

  /** @type {Map<string, ReturnType<typeof parseAndAnalyzeTs>>} */
  const perFile = new Map();

  for (const rel of uniq) {
    const abs = join(REPO_ROOT, rel);
    if (!existsSync(abs)) continue;
    try {
      const c = readFileSync(abs, 'utf8');
      const parsed = parseAndAnalyzeTs(rel, c);
      perFile.set(rel, parsed);
      if (!DEP_GRAPH[rel]) DEP_GRAPH[rel] = [];
      for (const e of parsed.edges) {
        if (!DEP_GRAPH[rel].includes(e)) DEP_GRAPH[rel].push(e);
      }
      for (const ex of parsed.exports) {
        EXPORTED_SYMBOLS.push({ file: rel, name: ex.name, line: ex.line, kind: ex.kind });
      }
      classifySupabaseFromRules(rel, c);
      scanSnapshotOptimistic(rel, c);
      scanVoidCatch(rel, c);
      scanStorageUploadAllowlist(rel, c);
    } catch {
      /* ignore */
    }
  }

  buildExportUsageIndex(uniq, perFile);
}

// ─── D: Drift detection ──────────────────────────────────────────────────────

function fingerprintFileSet(entries, { excludeGeneratedAudit = false } = {}) {
  const rows = entries
    .filter((e) => e.sha256 && (!excludeGeneratedAudit || !isGeneratedAuditArtifact(e.path)))
    .map((e) => `${e.path}\t${e.sha256}`)
    .sort();
  return createHash('sha256').update(rows.join('\n')).digest('hex');
}

function forbiddenSupabaseFingerprint() {
  const rows = SUPABASE_FROM_RULE_HITS.filter((h) => h.classification === 'forbidden')
    .map((h) => `${h.path}:${h.line}`)
    .sort();
  return createHash('sha256').update(rows.join('\n')).digest('hex');
}

function loadDriftBaseline() {
  if (!existsSync(DRIFT_BASELINE_PATH)) return null;
  try {
    return JSON.parse(readFileSync(DRIFT_BASELINE_PATH, 'utf8'));
  } catch {
    return null;
  }
}

function computeDrift(baseline, currentPaths, pathToSha, forbiddenHits) {
  if (!baseline || !baseline.files) {
    return {
      status: 'no_baseline',
      message: 'No docs/AUDIT_DRIFT_BASELINE.json — create with AUDIT_WRITE_BASELINE=1 after a clean audit.',
    };
  }
  const prevFiles = baseline.files;
  const prevPaths = new Set(Object.keys(prevFiles));
  const currPaths = new Set(currentPaths.filter((p) => !isGeneratedAuditArtifact(p)));

  const added = [...currPaths].filter((p) => !prevPaths.has(p)).sort();
  const removed = [...prevPaths].filter((p) => !currPaths.has(p)).sort();
  const modifiedCritical = [];
  for (const p of currPaths) {
    if (!prevFiles[p]) continue;
    if (pathToSha[p] && prevFiles[p] !== pathToSha[p] && isCriticalPath(p)) {
      modifiedCritical.push({ path: p, prev: prevFiles[p], curr: pathToSha[p] });
    }
  }

  const prevForbidden = new Set(baseline.forbidden_supabase_from || []);
  const currForbidden = new Set(forbiddenHits.map((h) => `${h.path}:${h.line}`));
  const violationsIntroduced = [...currForbidden].filter((x) => !prevForbidden.has(x)).sort();
  const violationsResolved = [...prevForbidden].filter((x) => !currForbidden.has(x)).sort();

  return {
    status: 'compared',
    added_files: added,
    removed_files: removed,
    modified_critical_files: modifiedCritical,
    forbidden_supabase_from_introduced: violationsIntroduced,
    forbidden_supabase_from_resolved: violationsResolved,
    manifest_fingerprint_prev: baseline.manifest_fingerprint || null,
    manifest_fingerprint_curr: null,
  };
}

function writeDriftBaseline(entries, manifestFp) {
  const files = {};
  for (const e of entries) {
    if (e.sha256 && !isGeneratedAuditArtifact(e.path)) files[e.path] = e.sha256;
  }
  const forbidden = SUPABASE_FROM_RULE_HITS.filter((h) => h.classification === 'forbidden')
    .map((h) => `${h.path}:${h.line}`)
    .sort();
  const payload = {
    version: 1,
    written_at: new Date().toISOString(),
    manifest_fingerprint: manifestFp,
    files,
    forbidden_supabase_from: forbidden,
    forbidden_supabase_fingerprint: forbiddenSupabaseFingerprint(),
  };
  writeFileSync(DRIFT_BASELINE_PATH, JSON.stringify(payload, null, 2), 'utf8');
}

function scanMigrationsSql() {
  const files = gitLsFiles().filter((p) => p.startsWith('supabase/migrations/') && p.endsWith('.sql'));
  const stats = {
    files: files.length,
    security_definer: 0,
    row_security_off: 0,
    for_all: 0,
    watchlist_for_all: 0,
    profiles_in_policy_qual: 0,
  };
  const watch = ['model_embeddings', 'model_locations', 'model_agency_territories', 'calendar_entries', 'model_minor_consent'];
  for (const rel of files) {
    const abs = join(REPO_ROOT, rel);
    let t = '';
    try {
      t = readFileSync(abs, 'utf8');
    } catch {
      continue;
    }
    if (/SECURITY\s+DEFINER/i.test(t)) stats.security_definer++;
    if (/row_security\s+TO\s+off/i.test(t) || /row_security\s*=\s*off/i.test(t)) stats.row_security_off++;
    if (/\bFOR\s+ALL\b/i.test(t)) stats.for_all++;
    for (const w of watch) {
      if (new RegExp(`ON\\s+public\\.${w}\\b`, 'i').test(t) && /\bFOR\s+ALL\b/i.test(t)) {
        stats.watchlist_for_all++;
        break;
      }
    }
    if (/CREATE\s+POLICY/i.test(t) && /profiles/i.test(t) && /is_admin/i.test(t)) stats.profiles_in_policy_qual++;
  }
  return stats;
}

function finalizeReviewStatus(entry, gates) {
  const { relPath, fileKind, category } = entry;
  if (fileKind === 'binary') {
    return {
      review_status: 'partially_reviewed',
      reason: 'binary_asset_no_semantic_code_review',
      evidence: ['sha256_file_hash'],
    };
  }
  if (fileKind === 'doc' || fileKind === 'governance') {
    return {
      review_status: 'partially_reviewed',
      reason: 'documentation_governance_text_not_executable_audit',
      evidence: ['manifest_enumeration'],
    };
  }
  if (category === 'supabase_other' && relPath.endsWith('.sql')) {
    return {
      review_status: 'partially_reviewed',
      reason: 'legacy_sql_superseded_by_migrations_for_live_db_truth',
      evidence: ['inventory_sha256', 'docs/SUPABASE_LEGACY_SQL_INVENTORY.md_if_present'],
    };
  }
  if (category === 'supabase_migrations' && fileKind === 'sql') {
    return {
      review_status: 'reviewed_automated',
      reason: null,
      evidence: ['migration_keyword_scan', 'sha256_file_hash'],
    };
  }
  if (category === 'supabase_functions' && relPath.endsWith('.ts')) {
    return {
      review_status: 'reviewed_manual',
      reason: null,
      evidence: ['checklist_edge_jwt_org_scope', `report_${ISO_DATE}`],
    };
  }
  if (fileKind === 'code' && inEslintScope(relPath)) {
    const ok = gates.eslint.ok && gates.typecheck.ok && gates.jest.ok;
    return {
      review_status: ok ? 'reviewed_automated' : 'partially_reviewed',
      reason: ok ? null : 'project_gates_failed_see_report',
      evidence: ['eslint_src_lib', 'tsc_project', 'jest_ci'],
    };
  }
  if (fileKind === 'code' && inTypecheckScope(relPath) && !inEslintScope(relPath)) {
    const ok = gates.typecheck.ok && gates.jest.ok;
    return {
      review_status: ok ? 'reviewed_automated' : 'partially_reviewed',
      reason: ok ? null : 'typecheck_or_test_failed',
      evidence: ['tsc_project', 'jest_ci'],
    };
  }
  if (fileKind === 'config' || category === 'github' || category === 'scripts') {
    return {
      review_status: 'partially_reviewed',
      reason: 'config_ci_script_review_manifest_only',
      evidence: ['manifest_enumeration', 'sha256_file_hash'],
    };
  }
  if (category === 'e2e') {
    return {
      review_status: 'partially_reviewed',
      reason: 'e2e_not_run_in_audit_pipeline_requires_dev_server',
      evidence: ['manifest_enumeration'],
    };
  }
  return {
    review_status: 'partially_reviewed',
    reason: 'default_bucket_manifest_only',
    evidence: ['manifest_enumeration', 'sha256_file_hash'],
  };
}

function main() {
  const paths = gitLsFiles();
  const gates = {
    typecheck: runGate('npm', ['run', 'typecheck', '--silent'], REPO_ROOT),
    eslint: runGate('npm', ['run', 'lint', '--silent'], REPO_ROOT),
    jest: runGate('npx', ['jest', '--passWithNoTests', '--ci', '--silent'], REPO_ROOT),
  };

  scanAllTsRoots();
  const migrationStats = scanMigrationsSql();

  /** @type {object[]} */
  const entries = [];
  for (const relPath of paths) {
    const abs = join(REPO_ROOT, relPath);
    const category = getCategory(relPath);
    const fileKind = getFileKind(relPath);
    const purpose = defaultPurpose(relPath, category, fileKind);
    const sha = sha256File(abs);
    const base = {
      path: relPath,
      category,
      file_kind: fileKind,
      purpose,
      sha256: sha,
    };
    const fin = finalizeReviewStatus({ relPath, fileKind, category }, gates);
    entries.push({ ...base, ...fin });
  }

  const summary = {};
  for (const e of entries) {
    summary[e.review_status] = (summary[e.review_status] || 0) + 1;
  }

  const manifestFingerprint = fingerprintFileSet(entries);
  const driftManifestFingerprint = fingerprintFileSet(entries, { excludeGeneratedAudit: true });
  const pathToSha = Object.fromEntries(entries.filter((e) => e.sha256).map((e) => [e.path, e.sha256]));
  const baseline = loadDriftBaseline();
  const drift = computeDrift(baseline, paths, pathToSha, SUPABASE_FROM_RULE_HITS.filter((h) => h.classification === 'forbidden'));
  if (drift.status === 'compared') drift.manifest_fingerprint_curr = driftManifestFingerprint;

  if (process.env.AUDIT_WRITE_BASELINE === '1') {
    writeDriftBaseline(entries, driftManifestFingerprint);
    console.log(`Wrote drift baseline: ${DRIFT_BASELINE_PATH}`);
  }

  const depNodes = new Set(Object.keys(DEP_GRAPH));
  for (const outs of Object.values(DEP_GRAPH)) for (const t of outs) depNodes.add(t);
  const depEdgeCount = Object.values(DEP_GRAPH).reduce((a, arr) => a + arr.length, 0);
  const supabaseRuleCounts = { allowed: 0, exception: 0, forbidden: 0 };
  for (const h of SUPABASE_FROM_RULE_HITS) {
    supabaseRuleCounts[h.classification] = (supabaseRuleCounts[h.classification] || 0) + 1;
  }

  writeFileSync(
    OUT_DEP_GRAPH,
    JSON.stringify({ generated_at: new Date().toISOString(), adjacency: DEP_GRAPH }, null, 2),
    'utf8',
  );
  writeFileSync(
    OUT_EXPORT_MAP,
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        exported_symbols: EXPORTED_SYMBOLS,
        export_to_importers: EXPORT_USAGE_SUMMARY,
      },
      null,
      2,
    ),
    'utf8',
  );

  const jsonOut = {
    generated_at: new Date().toISOString(),
    iso_date: ISO_DATE,
    total_paths: entries.length,
    manifest_fingerprint: manifestFingerprint,
    /** SHA256 over path+hash rows excluding generated audit docs (stable for drift). */
    drift_manifest_fingerprint: driftManifestFingerprint,
    gates: {
      typecheck: { ok: gates.typecheck.ok, exit: gates.typecheck.status },
      eslint: { ok: gates.eslint.ok, exit: gates.eslint.status },
      jest: { ok: gates.jest.ok, exit: gates.jest.status },
    },
    migration_sql_scan: migrationStats,
    dependency_graph: {
      node_count: depNodes.size,
      edge_count: depEdgeCount,
      detail_file: 'AUDIT_DEPENDENCY_GRAPH.json',
    },
    export_inventory: {
      exported_symbol_count: EXPORTED_SYMBOLS.length,
      internal_export_usage_entries: EXPORT_USAGE_SUMMARY.length,
      detail_file: 'AUDIT_EXPORT_MAP.json',
    },
    rule_engine: {
      supabase_from: {
        counts: supabaseRuleCounts,
        hits: SUPABASE_FROM_RULE_HITS,
      },
    },
    drift,
    rule_scans: {
      ui_supabase_from_forbidden_only: UI_SUPABASE_FROM,
      void_catch_candidates: VOID_CATCH,
      snapshot_pattern_hits: SNAPSHOT_PATTERNS,
      storage_upload_matrix_allowlist_violations: STORAGE_UPLOAD_RULE_VIOLATIONS,
    },
    ci_enforcement: {
      AUDIT_CI_ENFORCE: process.env.AUDIT_CI_ENFORCE === '1',
      AUDIT_FAIL_ON_ANY_FORBIDDEN: process.env.AUDIT_FAIL_ON_ANY_FORBIDDEN === '1',
      void_catch_production_count: VOID_CATCH.filter((x) => !x.path.includes('__tests__')).length,
      drift_no_baseline: drift.status === 'no_baseline',
      storage_upload_violations: STORAGE_UPLOAD_RULE_VIOLATIONS.length,
    },
    review_status_counts: summary,
    files: entries,
  };
  writeFileSync(OUT_JSON, JSON.stringify(jsonOut, null, 2), 'utf8');

  let md = `# Audit coverage manifest — ${ISO_DATE}\n\n`;
  md += `Generated by \`scripts/audit-coverage.mjs\` (deterministic: \`git ls-files\` + SHA-256 + gates).\n\n`;
  md += `Sidecars: [\`AUDIT_DEPENDENCY_GRAPH.json\`](./AUDIT_DEPENDENCY_GRAPH.json), [\`AUDIT_EXPORT_MAP.json\`](./AUDIT_EXPORT_MAP.json).\n\n`;
  md += `**Total paths:** ${entries.length}\n\n`;
  md += `## Gates\n\n`;
  md += `| Gate | OK | Exit |\n|---|---:|---:|\n`;
  md += `| typecheck | ${gates.typecheck.ok} | ${gates.typecheck.status} |\n`;
  md += `| eslint (src+lib) | ${gates.eslint.ok} | ${gates.eslint.status} |\n`;
  md += `| jest --ci | ${gates.jest.ok} | ${gates.jest.status} |\n\n`;
  md += `## Review status counts\n\n`;
  for (const [k, v] of Object.entries(summary).sort()) {
    md += `- **${k}:** ${v}\n`;
  }
  md += `\n## Migration SQL scan (supabase/migrations)\n\n`;
  md += `\`\`\`json\n${JSON.stringify(migrationStats, null, 2)}\n\`\`\`\n\n`;
  md += `## Dependency & rule engine summary\n\n`;
  md += `- **Dependency graph (src+lib):** ${depNodes.size} nodes, ${depEdgeCount} internal import edges\n`;
  md += `- **Exported symbols (AST):** ${EXPORTED_SYMBOLS.length}; **with internal importers:** ${EXPORT_USAGE_SUMMARY.length}\n`;
  md += `- **supabase.from rule engine:** allowed=${supabaseRuleCounts.allowed ?? 0}, exception=${supabaseRuleCounts.exception ?? 0}, forbidden=${supabaseRuleCounts.forbidden ?? 0}\n`;
  md += `- **void …catch( candidates:** ${VOID_CATCH.length}\n`;
  md += `- **storage upload outside matrix services:** ${STORAGE_UPLOAD_RULE_VIOLATIONS.length}\n`;
  md += `- **snapshot pattern hits (heuristic):** ${SNAPSHOT_PATTERNS.length}\n`;
  md += `- **Drift:** ${drift.status}${drift.status === 'compared' && drift.forbidden_supabase_from_introduced?.length ? ` — new forbidden supabase.from: ${drift.forbidden_supabase_from_introduced.length}` : ''}\n\n`;
  md += `## File listing\n\n`;
  md += `| path | category | file_kind | review_status | evidence |\n|---|---|---|---|---|\n`;
  for (const e of entries) {
    const ev = Array.isArray(e.evidence) ? e.evidence.join('; ') : '';
    const rs = e.reason ? `${e.review_status} (${e.reason})` : e.review_status;
    md += `| \`${e.path}\` | ${e.category} | ${e.file_kind} | ${rs} | ${ev} |\n`;
  }
  writeFileSync(OUT_MD, md, 'utf8');

  // Dedupe void_catch false positives: many tests use void promise.catch
  const voidCatchProd = VOID_CATCH.filter((x) => !x.path.includes('__tests__'));

  let report = `# System audit report — ${ISO_DATE}\n\n`;
  report += `This report is generated by [\`scripts/audit-coverage.mjs\`](../scripts/audit-coverage.mjs) together with the manifest [\`AUDIT_COVERAGE_MANIFEST_${ISO_DATE}.md\`](./AUDIT_COVERAGE_MANIFEST_${ISO_DATE}.md).\n\n`;
  report += `## 1. Coverage proof\n\n`;
  report += `- **Enumerated paths:** ${entries.length} (all git-tracked files).\n`;
  report += `- **Manifest JSON:** [\`AUDIT_COVERAGE_MANIFEST_${ISO_DATE}.json\`](./AUDIT_COVERAGE_MANIFEST_${ISO_DATE}.json)\n\n`;
  report += `### Review status aggregation\n\n`;
  for (const [k, v] of Object.entries(summary).sort()) {
    report += `- **${k}:** ${v}\n`;
  }
  report += `\n## 2. Automated gates\n\n`;
  report += `| Gate | Result |\n|---|---|\n`;
  report += `| \`npm run typecheck\` | ${gates.typecheck.ok ? 'PASS' : 'FAIL'} (exit ${gates.typecheck.status}) |\n`;
  report += `| \`npm run lint\` | ${gates.eslint.ok ? 'PASS' : 'FAIL'} (exit ${gates.eslint.status}) |\n`;
  report += `| \`jest --ci --passWithNoTests\` | ${gates.jest.ok ? 'PASS' : 'FAIL'} (exit ${gates.jest.status}) |\n\n`;
  if (!gates.typecheck.ok) {
    report += `### typecheck stderr (tail)\n\n\`\`\`\n${gates.typecheck.stderr}\n\`\`\`\n\n`;
  }
  if (!gates.eslint.ok) {
    report += `### eslint stderr (tail)\n\n\`\`\`\n${gates.eslint.stderr}\n\`\`\`\n\n`;
  }
  if (!gates.jest.ok) {
    report += `### jest stderr (tail)\n\n\`\`\`\n${gates.jest.stderr}\n\`\`\`\n\n`;
  }

  report += `## 3. SQL migrations (keyword scan)\n\n`;
  report += `Full-text scan of all files under \`supabase/migrations/*.sql\`:\n\n`;
  report += `- **files:** ${migrationStats.files}\n`;
  report += `- **mentions SECURITY DEFINER:** ${migrationStats.security_definer}\n`;
  report += `- **mentions row_security off:** ${migrationStats.row_security_off}\n`;
  report += `- **mentions FOR ALL:** ${migrationStats.for_all}\n`;
  report += `- **FOR ALL on watchlist table names (heuristic):** ${migrationStats.watchlist_for_all}\n`;
  report += `- **policies mentioning profiles + is_admin (heuristic):** ${migrationStats.profiles_in_policy_qual}\n\n`;
  const liveSnapPath = join(REPO_ROOT, 'docs', 'LIVE_DB_WATCHLIST_SNAPSHOT.md');
  if (existsSync(liveSnapPath)) {
    report += readFileSync(liveSnapPath, 'utf8').trimEnd() + '\n\n';
  }
  report += `> Further SECDEF inventory: [\`docs/AUDIT_REPORT_2026-04-07.md\`](./AUDIT_REPORT_2026-04-07.md), [\`docs/RLS_AUDIT_BACKLOG.md\`](./RLS_AUDIT_BACKLOG.md).\n\n`;
  report += `> **Note:** The watchlist \`FOR ALL\` count is a **heuristic** (same file mentions \`FOR ALL\` and \`ON public.<watchlist_table>\`) and may include fix migrations or comments — triage before treating as active risk.\n\n`;

  report += `## 4. Dependency graph, exports, rules, drift\n\n`;
  report += `### 4.0 Internal import graph (\`src/\` + \`lib/\`)\n\n`;
  report += `- **Nodes:** ${depNodes.size} (union of files that import or are imported internally)\n`;
  report += `- **Edges:** ${depEdgeCount} (static \`import\` / \`export from\` / dynamic \`import()\` to repo files)\n`;
  report += `- **Full adjacency:** [\`docs/AUDIT_DEPENDENCY_GRAPH.json\`](./AUDIT_DEPENDENCY_GRAPH.json).\n\n`;

  report += `### 4.1 Export inventory & internal usage\n\n`;
  report += `- **Exported symbols (functions/classes/consts via AST):** ${EXPORTED_SYMBOLS.length}\n`;
  report += `- **Symbols with ≥1 internal importer (named imports):** ${EXPORT_USAGE_SUMMARY.length}\n`;
  report += `- **Detail:** [\`docs/AUDIT_EXPORT_MAP.json\`](./AUDIT_EXPORT_MAP.json) (symbols + importers).\n\n`;

  report += `### 4.2 Rule engine: \`supabase.from(\`\n\n`;
  report += `| Classification | Count | Rule ID |\n|---:|---:|---|\n`;
  report += `| allowed (service/lib) | ${supabaseRuleCounts.allowed ?? 0} | \`supabase_from_service_layer\` |\n`;
  report += `| exception (AuthContext) | ${supabaseRuleCounts.exception ?? 0} | \`supabase_from_auth_context\` |\n`;
  report += `| forbidden | ${supabaseRuleCounts.forbidden ?? 0} | \`supabase_from_outside_service_layer\` |\n\n`;
  if (UI_SUPABASE_FROM.length === 0) {
    report += `No **forbidden** hits.\n\n`;
  } else {
    report += `**Forbidden hits:**\n\n`;
    report += `| File | Note |\n|---|---|\n`;
    for (const h of UI_SUPABASE_FROM) {
      report += `| \`${h.path}\` | ${h.note} |\n`;
    }
    report += `\n`;
  }

  report += `### 4.2b Storage \`supabase.storage.from(…).upload(\` — matrix allowlist\n\n`;
  report += `Only the service files listed in [\`.cursor/rules/upload-consent-matrix.mdc\`](../.cursor/rules/upload-consent-matrix.mdc) may perform **upload** chains (\`from\` → \`upload\`). Other storage calls (signed URL, list, remove) are ignored by this rule.\n\n`;
  if (STORAGE_UPLOAD_RULE_VIOLATIONS.length === 0) {
    report += `No violations.\n\n`;
  } else {
    report += `| File | Line | Snippet |\n|---|---:|---|\n`;
    for (const h of STORAGE_UPLOAD_RULE_VIOLATIONS) {
      report += `| \`${h.path}\` | ${h.line} | \`${String(h.text).replace(/`/g, "'")}\` |\n`;
    }
    report += `\n`;
  }

  report += `### 4.3 Drift vs \`docs/AUDIT_DRIFT_BASELINE.json\`\n\n`;
  if (drift.status === 'no_baseline') {
    report += `${drift.message}\n\n`;
  } else {
    report += `- **Added files:** ${drift.added_files?.length ?? 0}\n`;
    report += `- **Removed files:** ${drift.removed_files?.length ?? 0}\n`;
    report += `- **Modified critical files:** ${drift.modified_critical_files?.length ?? 0}\n`;
    report += `- **New forbidden \`supabase.from\` sites:** ${drift.forbidden_supabase_from_introduced?.length ?? 0}\n`;
    report += `- **Resolved forbidden sites:** ${drift.forbidden_supabase_from_resolved?.length ?? 0}\n`;
    report += `- **Drift manifest fingerprint (excludes generated \`docs/AUDIT_*\` / dated reports):** prev \`${drift.manifest_fingerprint_prev ?? 'n/a'}\` → curr \`${drift.manifest_fingerprint_curr ?? driftManifestFingerprint}\`\n\n`;
    if ((drift.forbidden_supabase_from_introduced?.length ?? 0) > 0) {
      report += `**Introduced forbidden lines:**\n\n`;
      for (const x of drift.forbidden_supabase_from_introduced) report += `- \`${x}\`\n`;
      report += `\n`;
    }
    if ((drift.modified_critical_files?.length ?? 0) > 0) {
      report += `**Critical path hash changes:**\n\n`;
      for (const m of drift.modified_critical_files) {
        report += `- \`${m.path}\`\n`;
      }
      report += `\n`;
    }
  }
  report += `Update baseline after intentional changes: \`AUDIT_WRITE_BASELINE=1 npm run audit:coverage\`. Optional CI gate: \`AUDIT_FAIL_ON_DRIFT=1\`.\n\n`;

  report += `### 4.4 \`void …catch(\` (Option-A dead-code risk; exclude tests)\n\n`;
  if (voidCatchProd.length === 0) {
    report += `No production-path hits (tests may still contain patterns).\n\n`;
  } else {
    report += `| File | Line | Snippet |\n|---|---:|---|\n`;
    for (const h of voidCatchProd) {
      report += `| \`${h.path}\` | ${h.line} | \`${h.text.replace(/`/g, "'")}\` |\n`;
    }
    report += `\n`;
  }
  report += `### 4.5 Snapshot-style optimistic rollback (heuristic)\n\n`;
  if (SNAPSHOT_PATTERNS.length === 0) {
    report += `No heuristic hits.\n\n`;
  } else {
    report += `| File | Line | Snippet |\n|---|---:|---|\n`;
    for (const h of SNAPSHOT_PATTERNS) {
      report += `| \`${h.path}\` | ${h.line} | \`${h.text.replace(/`/g, "'")}\` |\n`;
    }
    report += `\n`;
  }

  report += `## 5. Edge Functions — manual review (7/7)\n\n`;
  report += `| Function | AuthN | Secrets / trust | Scope guard |\n|---|---|---|---|\n`;
  report += `| **send-invite** | JWT via anon client + \`Authorization\` header | \`RESEND_API_KEY\` server-only | \`get_my_org_context\` RPC; optional \`organization_id\` must match caller membership (403 \`not_member_of_organization\`); multi-org warns + oldest row fallback |\n`;
  report += `| **delete-user** | JWT via anon client | \`SUPABASE_SERVICE_ROLE_KEY\` for \`auth.admin\` + storage cleanup | Self-delete OR \`get_own_admin_flags\` RPC (not raw \`profiles.is_admin\`) for cross-user delete |\n`;
  report += `| **create-checkout-session** | JWT via anon client | \`STRIPE_SECRET_KEY\`, service role for org resolution | \`org_id\` validated as caller owner; redirect URLs allowlisted (HTTPS + origin list, VULN-02) |\n`;
  report += `| **serve-watermarked-image** | JWT passed to client created with **service role** + user JWT | Service role for \`can_access_platform\` + signed URL | Bucket allowlist \`documentspictures\`; path must resolve to real \`models.id\` (IDOR hardening) |\n`;
  report += `| **member-remove** | JWT via anon client | Service role for admin session revoke | Caller must be **owner** of \`organizationId\` via \`organization_members\`; no self-remove |\n`;
  report += `| **send-push-notification** | \`x-webhook-secret\` timing-safe compare | \`WEBHOOK_SECRET\`, service role for DB | Only \`INSERT\` on \`public.notifications\`; \`ALLOWED_NOTIFICATION_TYPES\` allowlist |\n`;
  report += `| **stripe-webhook** | Stripe signature (\`STRIPE_WEBHOOK_SECRET\`) | Service role + \`STRIPE_SECRET_KEY\` | No CORS (server-to-server); subscription/org linking guard (\`checkSubscriptionLinking\`) |\n\n`;
  report += `Deploy flags: several functions use \`--no-verify-jwt\` at the edge; **in-function** JWT or webhook verification replaces the platform JWT gate — see each file’s header comments.\n\n`;

  report += `## 6. Governance: rule conflict (snapshots)\n\n`;
  report += `[\`.cursor/rules/system-invariants.mdc\`](../.cursor/rules/system-invariants.mdc) documents a **snapshot rollback** for \`addModelToProject\` as a special case, while [\`.cursorrules\`](../.cursorrules) / [\`auto-review.mdc\`](../.cursor/rules/auto-review.mdc) generally **forbid** snapshot-based optimistic rollback in favor of inverse operations.\n\n`;
  report += `**Recommendation:** Pick one canonical rule — either carve an explicit exception in global rules with justification (concurrent add-to-same-project semantics) or refactor \`ClientWebApp\` to inverse-operation rollback with per-id inflight locks. No rule file was changed in this audit run.\n\n`;

  report += `## 7. Findings summary (automated)\n\n`;
  const findings = [];
  if (!gates.typecheck.ok) findings.push({ sev: 'HIGH', cat: 'Consistency', desc: 'typecheck failed' });
  if (!gates.eslint.ok) findings.push({ sev: 'MEDIUM', cat: 'Consistency', desc: 'eslint failed' });
  if (!gates.jest.ok) findings.push({ sev: 'HIGH', cat: 'Logic', desc: 'jest failed' });
  if (migrationStats.watchlist_for_all > 0) {
    findings.push({
      sev: 'LOW',
      cat: 'Security',
      desc: `Heuristic: ${migrationStats.watchlist_for_all} migration file(s) mention both FOR ALL and a watchlist table name — may include fix/comment-only files; confirm live pg_policies (see RLS_AUDIT_BACKLOG).`,
    });
  }
  const uiFromPaths = [...new Set(UI_SUPABASE_FROM.map((h) => h.path))];
  for (const p of uiFromPaths) {
    findings.push({
      sev: 'LOW',
      cat: 'Architecture',
      desc: `Direct supabase.from in ${p}: prefer service layer for org-scoped queries.`,
    });
  }
  for (const h of voidCatchProd.slice(0, 20)) {
    findings.push({
      sev: 'LOW',
      cat: 'Consistency',
      desc: `void …catch( in ${h.path}:${h.line} — Option-A services may not reject; .then(ok) pattern preferred.`,
    });
  }
  for (const h of STORAGE_UPLOAD_RULE_VIOLATIONS.slice(0, 20)) {
    findings.push({
      sev: 'MEDIUM',
      cat: 'Security',
      desc: `Storage upload outside matrix allowlist: ${h.path}:${h.line} (${h.rule_id}).`,
    });
  }
  if (findings.length === 0) {
    report += `No automated findings beyond passing gates (see rule-scan tables for informational hits).\n\n`;
  } else {
    for (const f of findings) {
      report += `- **${f.sev}** (${f.cat}): ${f.desc}\n`;
    }
    report += `\n`;
  }

  report += `## 8. Incremental recommendations\n\n`;
  report += `1. CI runs \`npm run audit:coverage\` with \`AUDIT_FAIL_ON_DRIFT=1\` and \`AUDIT_CI_ENFORCE=1\` (see [\`docs/CI_AUDIT_AND_BASELINE.md\`](./CI_AUDIT_AND_BASELINE.md)).\n`;
  report += `2. Resolve snapshot vs inverse-operation governance and update code or rules once product decides.\n`;
  report += `3. Update [\`docs/LIVE_DB_WATCHLIST_SNAPSHOT.md\`](./LIVE_DB_WATCHLIST_SNAPSHOT.md) after material schema/policy migrations, then re-run \`npm run audit:coverage\`.\n\n`;

  writeFileSync(OUT_REPORT, report, 'utf8');

  let driftFail = false;
  if (process.env.AUDIT_FAIL_ON_DRIFT === '1' && drift.status === 'compared') {
    if ((drift.forbidden_supabase_from_introduced?.length ?? 0) > 0) driftFail = true;
    if ((drift.modified_critical_files?.length ?? 0) > 0) driftFail = true;
  }

  let ciRuleFail = false;
  if (process.env.AUDIT_CI_ENFORCE === '1') {
    if (drift.status === 'no_baseline') {
      ciRuleFail = true;
      console.error(
        '[audit] AUDIT_CI_ENFORCE: docs/AUDIT_DRIFT_BASELINE.json missing — run AUDIT_WRITE_BASELINE=1 npm run audit:coverage and commit.',
      );
    }
    if (voidCatchProd.length > 0) {
      ciRuleFail = true;
      console.error('[audit] AUDIT_CI_ENFORCE: void …catch( in production (non-__tests__) — use .then(ok) for Option-A services:');
      for (const h of voidCatchProd.slice(0, 30)) {
        console.error(`  ${h.path}:${h.line} ${h.text}`);
      }
      if (voidCatchProd.length > 30) console.error(`  … +${voidCatchProd.length - 30} more`);
    }
    if (STORAGE_UPLOAD_RULE_VIOLATIONS.length > 0) {
      ciRuleFail = true;
      console.error(
        '[audit] AUDIT_CI_ENFORCE: supabase.storage.from(…).upload( outside matrix allowlist — extend src/services or update .cursor/rules/upload-consent-matrix.mdc + STORAGE_UPLOAD_ALLOWLIST in audit-coverage.mjs:',
      );
      for (const h of STORAGE_UPLOAD_RULE_VIOLATIONS) {
        console.error(`  ${h.path}:${h.line} (${h.rule_id}) ${h.text}`);
      }
    }
    if (process.env.AUDIT_FAIL_ON_ANY_FORBIDDEN === '1' && (supabaseRuleCounts.forbidden ?? 0) > 0) {
      ciRuleFail = true;
      console.error(
        '[audit] AUDIT_FAIL_ON_ANY_FORBIDDEN: forbidden supabase.from sites must be zero — refactor to services or baseline drift only:',
      );
      for (const h of UI_SUPABASE_FROM.slice(0, 40)) {
        console.error(`  ${h.path}: ${h.note}`);
      }
    }
  }

  const gatesOk = gates.typecheck.ok && gates.eslint.ok && gates.jest.ok;
  console.log(
    `Wrote:\n  ${OUT_JSON}\n  ${OUT_DEP_GRAPH}\n  ${OUT_EXPORT_MAP}\n  ${OUT_MD}\n  ${OUT_REPORT}`,
  );
  process.exit(gatesOk && !driftFail && !ciRuleFail ? 0 : 1);
}

main();
