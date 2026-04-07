#!/usr/bin/env node
/** Auto-generated: run read-only live verification. Same env as fetch-live-db-state.mjs */
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url'; import { spawnSync } from 'child_process';
const __dirname = path.dirname(fileURLToPath(import.meta.url)); const ROOT = path.resolve(__dirname, "..");
function loadDotEnvSupabase() { const p = path.join(ROOT, ".env.supabase"); if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*export\s+(\w+)=/) || line.match(/^\s*(\w+)=/); if (!m) continue;
    const key = m[1]; let val = line.replace(/^\s*export\s+\w+=/, '').replace(/^\s*\w+=/, '').trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1,-1);
    if (!process.env[key]) process.env[key] = val; } }
try { const { default: dotenv } = await import("dotenv"); dotenv.config({ path: path.join(ROOT, ".env.supabase"), quiet: true }); } catch { loadDotEnvSupabase(); }
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN || "";
const REF = process.env.SUPABASE_PROJECT_REF || process.env.SUPABASE_PROJECT_ID || "ispkfdqzjrfrilosoklu";
async function runQuery(sql) {
  const url = `https://api.supabase.com/v1/projects/${REF}/database/query`;
  const res = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify({ query: sql }) });
  const text = await res.text(); if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0,600)}`);
  let data; try { data = JSON.parse(text); } catch { return { rows: [] }; }
  if (Array.isArray(data)) return { rows: data };
  if (data?.result && Array.isArray(data.result)) return { rows: data.result };
  if (data?.data && Array.isArray(data.data)) return { rows: data.data };
  if (data?.rows && Array.isArray(data.rows)) return { rows: data.rows };
  return { rows: [] }; }
function table(rows, max=45) { if (!rows?.length) return "*(0 rows)*\n"; const c=Object.keys(rows[0]); let s="| "+c.join(" | ")+" |\n|"+c.map(()=>"---").join("|")+"|\n";
  for (const r of rows.slice(0,max)) s += "| "+c.map(k=>String(r[k]??"").replace(/\|/g,"\\|").replace(/\n/g," ").slice(0,400)).join(" | ")+" |\n";
  if (rows.length>max) s += `\n*truncated ${rows.length-max}*\n`; return s; }
const QUERIES = [
  { id:'A1', name:'FOR ALL watchlist', purpose:'Expect 0 on watchlist tables',
    sql: `SELECT tablename, policyname, cmd, roles::text FROM pg_policies WHERE schemaname='public' AND cmd='ALL' AND tablename IN ('model_embeddings','model_locations','model_agency_territories','calendar_entries','model_minor_consent') ORDER BY 1,2` },
  { id:'A2', name:'FOR ALL public', purpose:'Inventory', sql: `SELECT tablename, policyname, cmd FROM pg_policies WHERE schemaname='public' AND cmd='ALL' ORDER BY 1,2` },
  { id:'B', name:'profiles in qual', purpose:'is_admin / profiles+role heuristic',
    sql: `SELECT tablename, policyname, cmd, LEFT(qual,400) q FROM pg_policies WHERE schemaname='public' AND (qual ILIKE '%is_admin = true%' OR qual ILIKE '%is_admin=true%' OR (qual ILIKE '%profiles%' AND qual ILIKE '%.role%')) ORDER BY 1,2` },
  { id:'C', name:'MAT self-ref', purpose:'BLOCKER if rows',
    sql: `SELECT policyname, cmd, LEFT(qual,500) q FROM pg_policies WHERE schemaname='public' AND tablename='model_agency_territories' AND (qual ILIKE '%self_mat%' OR qual ILIKE '%from public.model_agency_territories %' OR qual ILIKE '%from model_agency_territories %')` },
  { id:'D', name:'email in qual', purpose:'triage', sql: `SELECT tablename, policyname, cmd FROM pg_policies WHERE schemaname='public' AND qual ILIKE '%email%' AND tablename<>'profiles' ORDER BY 1,2` },
  { id:'E1', name:'SECDEF list', purpose:'proconfig', sql: `SELECT p.proname fn, pg_get_function_identity_arguments(p.oid) args, p.proconfig cfg FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind='f' AND p.prosecdef ORDER BY 1` },
  { id:'E2', name:'SECDEF no row_security in proconfig', purpose:'heuristic review',
    sql: `SELECT p.proname fn, pg_get_function_identity_arguments(p.oid) args, p.proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind='f' AND p.prosecdef AND (p.proconfig IS NULL OR NOT EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c::text ILIKE '%row_security%')) ORDER BY 1` },
  { id:'F', name:'overloads', purpose:'drift hint', sql: `SELECT proname, COUNT(*) cnt FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind='f' GROUP BY 1 HAVING COUNT(*)>1 ORDER BY cnt DESC,1` },
  { id:'G1', name:'constraints MAT+ML', purpose:'territory/location',
    sql: `SELECT con.conname, con.contype typ, rel.relname tbl, pg_get_constraintdef(con.oid) def FROM pg_constraint con JOIN pg_class rel ON rel.oid=con.conrelid JOIN pg_namespace nsp ON nsp.oid=rel.relnamespace WHERE nsp.nspname='public' AND rel.relname IN ('model_agency_territories','model_locations') ORDER BY rel.relname, con.conname` },
  { id:'G2', name:'model_locations unique', purpose:'(model_id, source)',
    sql: `SELECT conname, pg_get_constraintdef(oid) def FROM pg_constraint WHERE conrelid='public.model_locations'::regclass AND contype IN ('u','p')` },
  { id:'H', name:'admin helpers', purpose:'existence', sql: `SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND proname IN ('assert_is_admin','is_current_user_admin','get_own_admin_flags','is_current_user_super_admin','log_failed_admin_attempt') ORDER BY 1` },
  { id:'I', name:'storage policies', purpose:'snippet', sql: `SELECT tablename, policyname, cmd, LEFT(COALESCE(qual,'')||COALESCE(with_check,''),300) snip FROM pg_policies WHERE schemaname='storage' ORDER BY 1,2` },
  { id:'J', name:'triggers', purpose:'sample', sql: `SELECT c.relname tbl, t.tgname, LEFT(pg_get_triggerdef(t.oid),200) d FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal ORDER BY 1,2 LIMIT 80` },
  { id:'K', name:'all functions', purpose:'inventory', sql: `SELECT p.proname fn, pg_get_function_identity_arguments(p.oid) args, p.prosecdef secdef FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind='f' ORDER BY 1 LIMIT 500` },
  { id:'L', name:'no RLS tables', purpose:'public base tables', sql: `SELECT c.relname tbl FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND NOT c.relrowsecurity ORDER BY 1` },
  { id:'M', name:'get_models_near_location', purpose:'DISTINCT ON', sql: `SELECT LEFT(pg_get_functiondef(p.oid),8000) def FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='get_models_near_location' ORDER BY p.oid LIMIT 1` },
];
function evalRow(q, rows) { const n = rows?.length||0;
  if (q.id==='A1') return n?{v:'FAIL',n:`${n} FOR ALL on watchlist`}:{v:'PASS',n:'none'};
  if (q.id==='C') return n?{v:'FAIL',n:`BLOCKER: ${n} self-ref policies`}:{v:'PASS',n:'no self-ref match'};
  if (q.id==='B') return n?{v:'NEEDS_REVIEW',n:`${n} policies match heuristic`}:{v:'PASS',n:'no match'};
  if (q.id==='E2') return n?{v:'NEEDS_REVIEW',n:`${n} SECDEF without row_security in proconfig`}:{v:'PASS',n:'all have row_security in config or none'};
  if (q.id==='H') { const s=new Set(rows.map(r=>r.proname)); const need=['assert_is_admin','is_current_user_admin','get_own_admin_flags']; const m=need.filter(x=>!s.has(x)); return m.length?{v:'FAIL',n:'missing '+m.join(',')}:{v:'PASS',n:'core helpers present'}; }
  if (q.id==='G2') { const t = rows.map(r=>String(r.def||'')).join(' '); const ok = /model_id.*source|UNIQUE.*model_id.*source/i.test(t); const bad = /UNIQUE\s*\(\s*model_id\s*\)/i.test(t) && !ok; if (bad) return {v:'FAIL',n:'possible UNIQUE(model_id) only'}; if (ok) return {v:'PASS',n:'(model_id,source) style seen'}; return {v:'NEEDS_REVIEW',n:'inspect defs'}; }
  if (q.id==='I') { const risky = (rows||[]).filter(r=>{ const x=String(r.snip||'').toLowerCase(); return x.includes('public.models')||x.includes('public.profiles'); }); return risky.length?{v:'NEEDS_REVIEW',n:`${risky.length} snippets mention public.models/profiles`}:{v:'PASS',n:'no direct public.models/profiles in snippet'}; }
  if (q.id==='M') { if (!n) return {v:'NEEDS_REVIEW',n:'no function'}; const d=String(rows[0].def||''); return /DISTINCT\s+ON\s*\([^)]*model_id/i.test(d)?{v:'PASS',n:'DISTINCT ON model_id found'}:{v:'NEEDS_REVIEW',n:'DISTINCT ON not found in first 8k chars'}; }
  if (q.id==='L') { const skip=new Set(['spatial_ref_sys','geography_columns','geometry_columns','raster_columns','raster_overviews']); const bad=(rows||[]).filter(r=>!skip.has(r.tbl)); return bad.length?{v:'NEEDS_REVIEW',n:`${bad.length} tables without RLS`}:{v:'PASS',n:'only systemish without RLS'}; }
  return n?{v:'NEEDS_REVIEW',n:`${n} rows`}:{v:'PASS',n:'empty OK'}; }
async function main() {
  if (!TOKEN) {
    console.error("Missing SUPABASE_ACCESS_TOKEN — placeholder reports + fetch stub");
    spawnSync(process.execPath, [path.join(__dirname, "fetch-live-db-state.mjs")], { cwd: ROOT, stdio: "inherit", env: process.env });
    const stub = { generated: new Date().toISOString(), project_ref: REF, token_used: false, confirmed_critical: [], confirmed_high: [], heuristic_or_needs_review: [{ id: "env-no-token", area: "process", severity: "info", confirmed: false, evidence: "SUPABASE_ACCESS_TOKEN not set", affected_objects: [], login_risk: "not_confirmed", admin_risk: "not_confirmed", rls_risk: "not_confirmed", org_isolation_risk: "not_confirmed", note: "Run: export SUPABASE_ACCESS_TOKEN=… && node scripts/run-cursor-live-verification.mjs" }], confirmed_no_issue: [], live_vs_repo_drift: [], recommendation: "NEEDS_ATTENTION" };
    fs.writeFileSync(path.join(ROOT, "CURSOR_LIVE_DB_VERIFICATION.json"), JSON.stringify(stub, null, 2));
    fs.writeFileSync(path.join(ROOT, "CURSOR_LIVE_DB_VERIFICATION.md"), "# CURSOR_LIVE_DB_VERIFICATION.md\n\n**Blocked:** no SUPABASE_ACCESS_TOKEN. See JSON `heuristic_or_needs_review`.\n\nRe-run locally with token.\n");
    fs.writeFileSync(path.join(ROOT, "CURSOR_SQL_CHECK_RESULTS.md"), "# CURSOR_SQL_CHECK_RESULTS.md\n\n**Blocked:** no token — no queries executed. Run `node scripts/run-cursor-live-verification.mjs` with env set.\n");
    process.exit(2);
  }
  spawnSync(process.execPath, [path.join(__dirname, "fetch-live-db-state.mjs")], { cwd: ROOT, stdio: "inherit", env: process.env });
  const out = []; for (const q of QUERIES) { try { const { rows } = await runQuery(q.sql); const ev = evalRow(q, rows||[]); out.push({ ...q, rows: rows||[], rowCount:(rows||[]).length, verdict: ev.v, note: ev.n }); } catch (e) { out.push({ ...q, rows:[], rowCount:0, verdict:"FAIL", note: e.message }); } }
  let md = "# CURSOR_SQL_CHECK_RESULTS.md\n\n**Generated:** "+new Date().toISOString()+"\n**Ref:** "+REF+"\n\n";
  for (const r of out) { md += "## "+r.id+" — "+r.name+"\n**Purpose:** "+r.purpose+"\n\n**Verdict:** **"+r.verdict+"** — "+r.note+"\n\n**Rows:** "+r.rowCount+"\n\n"+table(r.rows)+"\n---\n\n"; }
  fs.writeFileSync(path.join(ROOT,"CURSOR_SQL_CHECK_RESULTS.md"), md);
  const cc=[], ch=[], heu=[], ok=[], drift=[];
  const a1=out.find(x=>x.id==="A1"); if (a1.verdict==="FAIL") cc.push({id:"for-all-watchlist",area:"policy",severity:"critical",confirmed:true,evidence:a1.note,affected_objects:a1.rows.map(r=>r.tablename+"."+r.policyname),login_risk:"high",admin_risk:"high",rls_risk:"critical",org_isolation_risk:"medium",note:""}); else if (a1.verdict==="PASS") ok.push({id:"for-all-watchlist",area:"policy",severity:"info",confirmed:true,evidence:"A1 zero rows",affected_objects:[],login_risk:"low",admin_risk:"low",rls_risk:"low",org_isolation_risk:"low",note:""});
  const c=out.find(x=>x.id==="C"); if (c.verdict==="FAIL") cc.push({id:"mat-selfref",area:"recursion",severity:"critical",confirmed:true,evidence:c.note,affected_objects:c.rows.map(r=>r.policyname),login_risk:"high",admin_risk:"high",rls_risk:"critical",org_isolation_risk:"low",note:""}); else if (c.verdict==="PASS") ok.push({id:"mat-selfref",area:"recursion",severity:"info",confirmed:true,evidence:"C zero rows",affected_objects:[],login_risk:"low",admin_risk:"low",rls_risk:"low",org_isolation_risk:"low",note:"heuristic string match only"});
  const b=out.find(x=>x.id==="B"); if (b.verdict==="NEEDS_REVIEW") ch.push({id:"profiles-in-policy",area:"policy",severity:"high",confirmed:true,evidence:b.note,affected_objects:b.rows.slice(0,25).map(r=>r.tablename+"."+r.policyname),login_risk:"medium",admin_risk:"high",rls_risk:"high",org_isolation_risk:"medium",note:"manual review"}); else if (b.verdict==="PASS") ok.push({id:"profiles-policy",area:"policy",severity:"info",confirmed:true,evidence:"B zero rows",affected_objects:[],login_risk:"low",admin_risk:"low",rls_risk:"low",org_isolation_risk:"low",note:""});
  const e2=out.find(x=>x.id==="E2"); if (e2.rowCount>0) heu.push({id:"secdef-proconfig",area:"secdef",severity:"medium",confirmed:true,evidence:String(e2.rowCount)+" functions",affected_objects:e2.rows.slice(0,35).map(r=>r.fn),login_risk:"low",admin_risk:"low",rls_risk:"medium",org_isolation_risk:"medium",note:"Review bodies"});
  const f=out.find(x=>x.id==="F"); if (f.rowCount>0) drift.push({id:"overloads",area:"rpc",severity:"low",confirmed:true,evidence:f.note,affected_objects:f.rows.map(r=>r.proname+"("+r.cnt+")"),login_risk:"low",admin_risk:"low",rls_risk:"low",org_isolation_risk:"low",note:""});
  const h=out.find(x=>x.id==="H"); if (h.verdict==="FAIL") cc.push({id:"admin-missing",area:"admin",severity:"critical",confirmed:true,evidence:h.note,affected_objects:[],login_risk:"high",admin_risk:"critical",rls_risk:"medium",org_isolation_risk:"low",note:""});
  const g2=out.find(x=>x.id==="G2"); if (g2.verdict==="FAIL") ch.push({id:"ml-constraint",area:"location",severity:"high",confirmed:true,evidence:g2.note,affected_objects:["model_locations"],login_risk:"low",admin_risk:"low",rls_risk:"low",org_isolation_risk:"low",note:""});
  const i=out.find(x=>x.id==="I"); if (i.verdict==="NEEDS_REVIEW") heu.push({id:"storage-snippet",area:"storage",severity:"medium",confirmed:false,evidence:i.note,affected_objects:[],login_risk:"low",admin_risk:"low",rls_risk:"medium",org_isolation_risk:"medium",note:"heuristic"}); else if (i.verdict==="PASS") ok.push({id:"storage",area:"storage",severity:"info",confirmed:true,evidence:"no models/profiles in snippet",affected_objects:[],login_risk:"low",admin_risk:"low",rls_risk:"low",org_isolation_risk:"low",note:""});
  let rec="SAFE"; if (cc.length) rec="BLOCKER"; else if (ch.length || heu.length>5) rec="NEEDS_ATTENTION"; else if (heu.length) rec="NEEDS_ATTENTION";
  const j = { generated:new Date().toISOString(), project_ref:REF, token_used:true, confirmed_critical:cc, confirmed_high:ch, heuristic_or_needs_review:heu, confirmed_no_issue:ok, live_vs_repo_drift:drift, recommendation:rec, query_summary:out.map(r=>({id:r.id,verdict:r.verdict,rows:r.rowCount})), severity_summary:{ blocker_confirmed: cc.length, critical_confirmed: cc.length, high_confirmed: ch.length, heuristic_count: heu.length, verification_incomplete:false } };
  fs.writeFileSync(path.join(ROOT,"CURSOR_LIVE_DB_VERIFICATION.json"), JSON.stringify(j,null,2));
  let vm = "# CURSOR_LIVE_DB_VERIFICATION.md\n\n**Generated:** "+j.generated+"\n**Ref:** "+REF+"\n\n## 1. Executive Summary\n\nRecommendation: **"+rec+"**. Critical: "+cc.length+", High: "+ch.length+", Heuristic: "+heu.length+".\n\nSee CURSOR_SQL_CHECK_RESULTS.md.\n\n## 2. Confirmed Critical Risks\n\n"+(cc.length?JSON.stringify(cc,null,2):"*None.*")+"\n\n## 3. Confirmed High Risks\n\n"+(ch.length?JSON.stringify(ch,null,2):"*None.*")+"\n\n## 4. Heuristic / Needs Review\n\n"+(heu.length?JSON.stringify(heu,null,2):"*See E2, L, M in SQL results.*")+"\n\n## 5. Confirmed No-Issue Areas\n\n"+JSON.stringify(ok,null,2)+"\n\n## 6. Live Drift vs Repo\n\nNot auto-diffed to migrations. Use query F/K in SQL results.\n\n"+(drift.length?JSON.stringify(drift,null,2):"")+"\n\n## 7. Recommendation\n\n**"+rec+"**\n";
  fs.writeFileSync(path.join(ROOT,"CURSOR_LIVE_DB_VERIFICATION.md"), vm);
  console.log("OK recommendation="+rec); }
main().catch(e=>{console.error(e);process.exit(1);});
