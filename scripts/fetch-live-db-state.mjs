#!/usr/bin/env node
/**
 * Liest Live-Metadaten aus dem verlinkten Supabase-Projekt (Management API)
 * und schreibt CHATGPT_LIVE_DB_STATE.txt — keine App-Code-Änderungen.
 *
 * Voraussetzung:
 *   SUPABASE_ACCESS_TOKEN  (Dashboard → Account → Access Tokens)
 *   SUPABASE_PROJECT_REF   (optional, Default aus supabase/config.toml)
 *
 * Optional: Werte in .env.supabase (wird nicht ausgegeben)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'CHATGPT_LIVE_DB_STATE.txt');

function loadDotEnvSupabase() {
  const p = path.join(ROOT, '.env.supabase');
  if (!fs.existsSync(p)) return;
  const raw = fs.readFileSync(p, 'utf8');
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*export\s+(\w+)=/);
    const m2 = line.match(/^\s*(\w+)=/);
    const key = m?.[1] ?? m2?.[1];
    if (!key) continue;
    let val = line.replace(/^\s*export\s+\w+=/, '').replace(/^\s*\w+=/, '').trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

try {
  const dotenv = await import('dotenv');
  dotenv.config({ path: path.join(ROOT, '.env.supabase'), quiet: true });
} catch {
  loadDotEnvSupabase();
}

const TOKEN = process.env.SUPABASE_ACCESS_TOKEN || '';
const REF =
  process.env.SUPABASE_PROJECT_REF ||
  process.env.SUPABASE_PROJECT_ID ||
  'ispkfdqzjrfrilosoklu';

const SQL_APPENDIX = `
-- =============================================================================
-- ANHANG: Dieselben Abfragen für den Supabase SQL Editor (ohne Management API)
-- =============================================================================

-- 1 Tabellen public
SELECT table_schema, table_name, table_type
FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;

-- 1b RLS-Flags
SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS rls_forced
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r'
ORDER BY c.relname;

-- 2 Policies public + storage
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname IN ('public', 'storage')
ORDER BY schemaname, tablename, policyname;

-- 3 SECURITY DEFINER
SELECT p.proname AS function_name,
       pg_get_function_identity_arguments(p.oid) AS args,
       p.prosecdef AS security_definer,
       p.provolatile AS volatility,
       p.proconfig AS config
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.prosecdef = true
ORDER BY p.proname;

-- 4 Trigger
SELECT c.relname AS table_name, t.tgname AS trigger_name,
       pg_get_triggerdef(t.oid) AS definition, t.tgenabled::text AS enabled
FROM pg_trigger t
JOIN pg_class c ON t.tgrelid = c.oid
JOIN pg_namespace n ON c.relnamespace = n.oid
WHERE n.nspname = 'public' AND NOT t.tgisinternal
ORDER BY c.relname, t.tgname;

-- 5 Constraints
SELECT con.conname AS constraint_name, con.contype AS type, nsp.nspname AS schema_name,
       rel.relname AS table_name, pg_get_constraintdef(con.oid) AS definition
FROM pg_constraint con
JOIN pg_class rel ON rel.oid = con.conrelid
JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
WHERE nsp.nspname = 'public'
ORDER BY rel.relname, con.conname;

-- 5b Territories/Locations
SELECT con.conname, con.contype AS type, rel.relname AS table_name,
       pg_get_constraintdef(con.oid) AS definition
FROM pg_constraint con
JOIN pg_class rel ON rel.oid = con.conrelid
JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
WHERE nsp.nspname = 'public'
  AND rel.relname ~* '(territor|location|model_location|country)'
ORDER BY rel.relname, con.conname;

-- 6 Storage policies
SELECT * FROM pg_policies WHERE schemaname = 'storage' ORDER BY tablename, policyname;

-- 7 Alle public Funktionen (RPC-Liste)
SELECT p.proname AS function_name,
       pg_get_function_identity_arguments(p.oid) AS args,
       p.prosecdef AS security_definer,
       p.provolatile AS volatility
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public' AND p.prokind = 'f'
ORDER BY p.proname;
`;

const CRITICAL_TABLES = new Set([
  'profiles',
  'models',
  'organization_members',
  'organizations',
  'option_requests',
  'booking_events',
  'guest_links',
  'messages',
  'audit_trail',
  'security_events',
  'consent_log',
  'image_rights_confirmations',
  'model_minor_consent',
]);

function redactCell(v) {
  if (v == null) return v;
  const s = String(v);
  return s
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED_SECRET]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED_SECRET]')
    .replace(/\bsk_(live|test)_[A-Za-z0-9]+\b/g, '[REDACTED_SECRET]');
}

function formatRows(title, rows) {
  let out = `\n${'='.repeat(80)}\n${title}\n${'='.repeat(80)}\n`;
  if (!rows?.length) {
    out += '(keine Zeilen)\n';
    return out;
  }
  const cols = Object.keys(rows[0]);
  out += cols.join('\t') + '\n';
  for (const r of rows) {
    out += cols.map((c) => redactCell(r[c])).join('\t') + '\n';
  }
  out += `\n(Zeilen: ${rows.length})\n`;
  return out;
}

async function runQuery(sql) {
  const url = `https://api.supabase.com/v1/projects/${REF}/database/query`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: sql }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 500)}`);
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { raw: text };
  }
  if (Array.isArray(data)) return { rows: data };
  if (data?.result && Array.isArray(data.result)) return { rows: data.result };
  if (data?.data && Array.isArray(data.data)) return { rows: data.data };
  if (data?.rows && Array.isArray(data.rows)) return { rows: data.rows };
  return { rows: [], meta: data };
}

function analyzeSecurity(policies, functions) {
  let s = `\n${'='.repeat(80)}\n8. SICHERHEITS-CHECKS (heuristisch, aus Metadaten)\n${'='.repeat(80)}\n`;

  const pubPolicies = policies.filter((p) => p.schemaname === 'public');
  const forAll = pubPolicies.filter((p) => p.cmd === '*' || p.cmd === 'ALL');
  const forAllCritical = forAll.filter((p) => CRITICAL_TABLES.has(p.tablename));
  s += '\n8.1 FOR ALL / ALL Policies (cmd = *) auf kritischen Tabellen:\n';
  if (forAllCritical.length === 0) {
    s += '- Keine *-Policy auf den definierten kritischen Tabellen gefunden.\n';
  } else {
    for (const p of forAllCritical) {
      s += `- [${p.tablename}] ${p.policyname} (roles: ${p.roles})\n`;
    }
  }
  s += `\nAlle FOR ALL (* ) im public-Schema (ggf. auch unkritisch): ${forAll.length}\n`;

  s += '\n8.2 profiles.role in RLS (qual / with_check Text-Suche):\n';
  const roleHits = pubPolicies.filter((p) => {
    const q = `${p.qual || ''} ${p.with_check || ''}`.toLowerCase();
    return q.includes('profiles') && q.includes('role');
  });
  if (roleHits.length === 0) {
    s += '- Keine Policy gefunden, deren qual/with_check gleichzeitig „profiles“ und „role“ enthält (heuristisch).\n';
  } else {
    for (const p of roleHits) {
      s += `- [${p.tablename}] ${p.policyname}\n`;
    }
  }

  s += '\n8.3 Policies auf model_agency_territories (Self-Referencing manuell prüfen):\n';
  const mat = pubPolicies.filter((p) => p.tablename === 'model_agency_territories');
  if (mat.length === 0) {
    s += '- Keine Policies für Tabelle model_agency_territories in pg_policies (oder Tabelle fehlt).\n';
  } else {
    for (const p of mat) {
      const q = `${p.qual || ''} ${p.with_check || ''}`;
      const selfRef = /model_agency_territories/i.test(q) && q.split(/model_agency_territories/gi).length > 2;
      s += `- ${p.policyname} cmd=${p.cmd} self_ref_hint=${selfRef ? 'maybe' : 'unclear'}\n`;
    }
  }

  s += '\n8.4 SECURITY DEFINER Funktionen ohne row_security=off in proconfig:\n';
  const definer = functions.filter(
    (f) => f.security_definer === true || f.security_definer === 't' || f.security_definer === 'true',
  );
  const missingRsoff = definer.filter((f) => {
    const cfg = f.config;
    const c = Array.isArray(cfg) ? cfg.join(',') : String(cfg || '');
    return !c.includes('row_security=off');
  });
  s += `- SECURITY DEFINER gesamt (public): ${definer.length}\n`;
  s += `- davon ohne row_security=off in proconfig: ${missingRsoff.length}\n`;
  if (missingRsoff.length && missingRsoff.length <= 40) {
    for (const f of missingRsoff.slice(0, 40)) {
      s += `  · ${f.function_name}(${f.args || ''}) config=${JSON.stringify(f.config)}\n`;
    }
  } else if (missingRsoff.length > 40) {
    s += '  (Liste gekürzt — siehe Abschnitt 3.)\n';
  }

  return s;
}

function sectionTerritoryUniqueSummary(rows) {
  let s = '\n8.5 Unique Constraints Territories/Locations — Kurzfassung:\n';
  const uniq = (rows || []).filter((r) => r.type === 'u');
  s += `- Anzahl UNIQUE (u) in gefilterter Liste: ${uniq.length}\n`;
  if (uniq.length) {
    for (const r of uniq) {
      s += `  · [${r.table_name}] ${r.constraint_name}: ${redactCell(r.definition)}\n`;
    }
  } else {
    s +=
      '- Keine UNIQUE-Constraints in den per Namen gefilterten Tabellen — vollständige Liste siehe Abschnitt 5.\n';
  }
  return s;
}

async function main() {
  const ts = new Date().toISOString();
  let buf = '';
  buf += `${'='.repeat(80)}\n`;
  buf += `CHATGPT_LIVE_DB_STATE\n`;
  buf += `GENERATED: ${ts}\n`;
  buf += `PROJECT_REF: ${REF}\n`;
  buf += `WARNING: Struktur/Metadaten only — secrets redacted where detected in cell text\n`;
  buf += `${'='.repeat(80)}\n`;

  if (!TOKEN) {
    buf += `
KEIN SUPABASE_ACCESS_TOKEN gesetzt.

So erzeugst du diese Datei lokal:
  export SUPABASE_ACCESS_TOKEN="…"   # vom Supabase-Dashboard
  export SUPABASE_PROJECT_REF="${REF}"   # optional
  node scripts/fetch-live-db-state.mjs

Oder Werte in .env.supabase (nicht committen).

Die folgenden SQL-Blöcke kannst du bei Bedarf manuell im SQL Editor ausführen.
`;
    buf += `\n${SQL_APPENDIX}\n`;
    fs.writeFileSync(OUT, buf, 'utf8');
    console.error('Hinweis: CHATGPT_LIVE_DB_STATE.txt enthält nur Stub (kein Token).');
    process.exit(0);
  }

  const queries = {
    tables: `SELECT table_schema, table_name, table_type
             FROM information_schema.tables
             WHERE table_schema = 'public'
             ORDER BY table_name;`,

    rlsEnabled: `SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS rls_forced
                  FROM pg_class c
                  JOIN pg_namespace n ON n.oid = c.relnamespace
                  WHERE n.nspname = 'public' AND c.relkind = 'r'
                  ORDER BY c.relname;`,

    policies: `SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
               FROM pg_policies
               WHERE schemaname IN ('public', 'storage')
               ORDER BY schemaname, tablename, policyname;`,

    secdefFunctions: `SELECT
                        p.proname AS function_name,
                        pg_get_function_identity_arguments(p.oid) AS args,
                        p.prosecdef AS security_definer,
                        p.provolatile AS volatility,
                        p.proconfig AS config
                      FROM pg_proc p
                      JOIN pg_namespace n ON p.pronamespace = n.oid
                      WHERE n.nspname = 'public' AND p.prokind = 'f'
                        AND p.prosecdef = true
                      ORDER BY p.proname;`,

    allPublicFunctions: `SELECT
                          p.proname AS function_name,
                          pg_get_function_identity_arguments(p.oid) AS args,
                          p.prosecdef AS security_definer,
                          p.provolatile AS volatility
                        FROM pg_proc p
                        JOIN pg_namespace n ON p.pronamespace = n.oid
                        WHERE n.nspname = 'public' AND p.prokind = 'f'
                        ORDER BY p.proname;`,

    triggers: `SELECT
                 c.relname AS table_name,
                 t.tgname AS trigger_name,
                 pg_get_triggerdef(t.oid) AS definition,
                 t.tgenabled::text AS enabled
               FROM pg_trigger t
               JOIN pg_class c ON t.tgrelid = c.oid
               JOIN pg_namespace n ON c.relnamespace = n.oid
               WHERE n.nspname = 'public' AND NOT t.tgisinternal
               ORDER BY c.relname, t.tgname;`,

    constraints: `SELECT
                     con.conname AS constraint_name,
                     con.contype AS type,
                     nsp.nspname AS schema_name,
                     rel.relname AS table_name,
                     pg_get_constraintdef(con.oid) AS definition
                   FROM pg_constraint con
                   JOIN pg_class rel ON rel.oid = con.conrelid
                   JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
                   WHERE nsp.nspname = 'public'
                   ORDER BY rel.relname, con.conname;`,

    storagePolicies: `SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
                       FROM pg_policies
                       WHERE schemaname = 'storage'
                       ORDER BY tablename, policyname;`,

    territoryLocationConstraints: `SELECT
                     con.conname AS constraint_name,
                     con.contype AS type,
                     rel.relname AS table_name,
                     pg_get_constraintdef(con.oid) AS definition
                   FROM pg_constraint con
                   JOIN pg_class rel ON rel.oid = con.conrelid
                   JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
                   WHERE nsp.nspname = 'public'
                     AND rel.relname ~* '(territor|location|model_location|country)'
                   ORDER BY rel.relname, con.conname;`,
  };

  try {
    buf += `\n${'='.repeat(80)}\n1. TABELLEN (public, information_schema)\n${'='.repeat(80)}\n`;
    const t1 = await runQuery(queries.tables);
    buf += formatRows('tables', t1.rows);

    buf += `\n${'='.repeat(80)}\n1b. RLS pro Tabelle (pg_class)\n${'='.repeat(80)}\n`;
    const t1b = await runQuery(queries.rlsEnabled);
    buf += formatRows('rls flags', t1b.rows);

    buf += `\n${'='.repeat(80)}\n2. RLS POLICIES (pg_policies: public + storage)\n${'='.repeat(80)}\n`;
    const t2 = await runQuery(queries.policies);
    buf += formatRows('pg_policies', t2.rows);

    buf += `\n${'='.repeat(80)}\n3. SECURITY DEFINER FUNKTIONEN (public)\n${'='.repeat(80)}\n`;
    const t3 = await runQuery(queries.secdefFunctions);
    buf += formatRows('security definer', t3.rows);

    buf += `\n${'='.repeat(80)}\n4. TRIGGER (public, pg_get_triggerdef)\n${'='.repeat(80)}\n`;
    const t4 = await runQuery(queries.triggers);
    buf += formatRows('triggers', t4.rows);

    buf += `\n${'='.repeat(80)}\n5. CONSTRAINTS (public, pg_get_constraintdef)\n${'='.repeat(80)}\n`;
    const t5 = await runQuery(queries.constraints);
    buf += formatRows('constraints', t5.rows);

    buf += `\n${'='.repeat(80)}\n5b. CONSTRAINTS — Territories / Locations (Filter)\n${'='.repeat(80)}\n`;
    const t5b = await runQuery(queries.territoryLocationConstraints);
    buf += formatRows('territory/location related', t5b.rows);

    buf += `\n${'='.repeat(80)}\n6. STORAGE POLICIES (pg_policies, schema storage)\n${'='.repeat(80)}\n`;
    const t6 = await runQuery(queries.storagePolicies);
    buf += formatRows('storage policies', t6.rows);

    buf += `\n${'='.repeat(80)}\n7. RPC / FUNKTIONEN (alle public, inkl. SECURITY DEFINER-Flag)\n${'='.repeat(80)}\n`;
    const t7 = await runQuery(queries.allPublicFunctions);
    buf += formatRows('public functions', t7.rows);

    buf += analyzeSecurity(t2.rows || [], t7.rows || []);
    buf += sectionTerritoryUniqueSummary(t5b.rows);

    buf += `\n${SQL_APPENDIX}\n`;
    fs.writeFileSync(OUT, buf, 'utf8');
    console.log('OK:', OUT);
  } catch (e) {
    buf += `\n\nFEHLER: ${e.message}\n`;
    fs.writeFileSync(OUT, buf, 'utf8');
    console.error(e);
    process.exit(1);
  }
}

main();
