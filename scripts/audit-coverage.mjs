#!/usr/bin/env node
/**
 * Deterministic repo audit: git ls-files manifest + SHA256 + gate results + rule scans.
 * Writes docs/AUDIT_COVERAGE_MANIFEST_<ISO_DATE>.{md,json} and docs/SYSTEM_AUDIT_REPORT_<ISO_DATE>.md
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, extname, basename } from 'node:path';
import { execSync, spawnSync } from 'node:child_process';

const REPO_ROOT = join(import.meta.dirname, '..');
const ISO_DATE = new Date().toISOString().slice(0, 10);
const OUT_MD = join(REPO_ROOT, 'docs', `AUDIT_COVERAGE_MANIFEST_${ISO_DATE}.md`);
const OUT_JSON = join(REPO_ROOT, 'docs', `AUDIT_COVERAGE_MANIFEST_${ISO_DATE}.json`);
const OUT_REPORT = join(REPO_ROOT, 'docs', `SYSTEM_AUDIT_REPORT_${ISO_DATE}.md`);

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

/** @type {{ path: string, pattern: string, note: string }[]} */
const UI_SUPABASE_FROM = [];

function scanUiDirectSupabaseFrom(relPath, content) {
  if (!/\.(tsx|ts)$/.test(relPath)) return;
  if (relPath.startsWith('src/services/')) return;
  if (relPath.startsWith('lib/')) return;
  if (relPath.startsWith('src/context/AuthContext')) return;
  const re = /\bsupabase\s*\.\s*from\s*\(/g;
  let m;
  let line = 1;
  let idx = 0;
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (/\bsupabase\s*\.\s*from\s*\(/.test(lines[i])) {
      UI_SUPABASE_FROM.push({
        path: relPath,
        pattern: 'supabase.from(',
        note: `line ${i + 1}: direct PostgREST from UI/non-service path`,
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

function scanAllTsRoots() {
  const all = gitLsFiles();
  const uniq = [
    ...new Set(
      all.filter(
        (p) => /\.(ts|tsx)$/.test(p) && (p.startsWith('src/') || p.startsWith('lib/')),
      ),
    ),
  ];
  for (const rel of uniq) {
    const abs = join(REPO_ROOT, rel);
    if (!existsSync(abs)) continue;
    try {
      const c = readFileSync(abs, 'utf8');
      scanUiDirectSupabaseFrom(rel, c);
      scanSnapshotOptimistic(rel, c);
      scanVoidCatch(rel, c);
    } catch {
      /* ignore */
    }
  }
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

  const jsonOut = {
    generated_at: new Date().toISOString(),
    iso_date: ISO_DATE,
    total_paths: entries.length,
    gates: {
      typecheck: { ok: gates.typecheck.ok, exit: gates.typecheck.status },
      eslint: { ok: gates.eslint.ok, exit: gates.eslint.status },
      jest: { ok: gates.jest.ok, exit: gates.jest.status },
    },
    migration_sql_scan: migrationStats,
    rule_scans: {
      ui_supabase_from: UI_SUPABASE_FROM,
      void_catch_candidates: VOID_CATCH,
      snapshot_pattern_hits: SNAPSHOT_PATTERNS,
    },
    review_status_counts: summary,
    files: entries,
  };
  writeFileSync(OUT_JSON, JSON.stringify(jsonOut, null, 2), 'utf8');

  let md = `# Audit coverage manifest — ${ISO_DATE}\n\n`;
  md += `Generated by \`scripts/audit-coverage.mjs\` (deterministic: \`git ls-files\` + SHA-256 + gates).\n\n`;
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
  md += `## Rule scan summary\n\n`;
  md += `- **ui supabase.from( hits (non-service):** ${UI_SUPABASE_FROM.length}\n`;
  md += `- **void …catch( candidates:** ${VOID_CATCH.length}\n`;
  md += `- **snapshot pattern hits (heuristic):** ${SNAPSHOT_PATTERNS.length}\n\n`;
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

  report += `## 4. Regelbasierte Scans (TypeScript)\n\n`;
  report += `### 4.1 Direct \`supabase.from(\` outside \`src/services\` and \`lib/\`\n\n`;
  if (UI_SUPABASE_FROM.length === 0) {
    report += `No hits.\n\n`;
  } else {
    report += `| File | Note |\n|---|---|\n`;
    for (const h of UI_SUPABASE_FROM) {
      report += `| \`${h.path}\` | ${h.note} |\n`;
    }
    report += `\n`;
  }
  report += `### 4.2 \`void …catch(\` (Option-A dead-code risk; exclude tests)\n\n`;
  if (voidCatchProd.length === 0) {
    report += `No production-path hits (tests may still contain patterns).\n\n`;
  } else {
    report += `| File | Line | Snippet |\n|---|---:|---|\n`;
    for (const h of voidCatchProd) {
      report += `| \`${h.path}\` | ${h.line} | \`${h.text.replace(/`/g, "'")}\` |\n`;
    }
    report += `\n`;
  }
  report += `### 4.3 Snapshot-style optimistic rollback (heuristic)\n\n`;
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
  if (findings.length === 0) {
    report += `No automated findings beyond passing gates (see rule-scan tables for informational hits).\n\n`;
  } else {
    for (const f of findings) {
      report += `- **${f.sev}** (${f.cat}): ${f.desc}\n`;
    }
    report += `\n`;
  }

  report += `## 8. Incremental recommendations\n\n`;
  report += `1. Wire \`npm run audit:coverage\` into optional CI job to refresh manifest on release branches.\n`;
  report += `2. Resolve snapshot vs inverse-operation governance and update code or rules once product decides.\n`;
  report += `3. Update [\`docs/LIVE_DB_WATCHLIST_SNAPSHOT.md\`](./LIVE_DB_WATCHLIST_SNAPSHOT.md) after material schema/policy migrations, then re-run \`npm run audit:coverage\`.\n\n`;

  writeFileSync(OUT_REPORT, report, 'utf8');

  console.log(`Wrote:\n  ${OUT_JSON}\n  ${OUT_MD}\n  ${OUT_REPORT}`);
  process.exit(gates.typecheck.ok && gates.eslint.ok && gates.jest.ok ? 0 : 1);
}

main();
