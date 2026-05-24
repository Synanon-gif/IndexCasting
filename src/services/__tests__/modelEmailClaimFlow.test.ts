/**
 * Model email / claim flow regression guards — no new email-identity paths.
 */
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.join(__dirname, '../../..');

function readSrc(relative: string): string {
  return fs.readFileSync(path.join(ROOT, relative), 'utf8');
}

describe('model email / claim flow invariants', () => {
  it('resend invite uses model.email from the passed model object', () => {
    const src = readSrc('src/views/AgencyControllerView.tsx');
    const fnStart = src.indexOf('const handleResendModelClaimInvite');
    expect(fnStart).toBeGreaterThanOrEqual(0);
    const fnEnd = src.indexOf('const handle', fnStart + 1);
    const fnChunk = src.slice(fnStart, fnEnd > fnStart ? fnEnd : fnStart + 2500);
    expect(fnChunk).toMatch(/const email = model\.email\?\.trim\(\)/);
    expect(fnChunk).toMatch(/resendInviteEmail\(\{[\s\S]*email,/);
  });

  it('agency_update_model_full migration path does not clear models.user_id on email update', () => {
    const migrationsDir = path.join(ROOT, 'supabase/migrations');
    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.includes('agency_update_model_full'));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const sql = fs.readFileSync(path.join(migrationsDir, f), 'utf8');
      if (!/CREATE OR REPLACE FUNCTION public\.agency_update_model_full/i.test(sql)) continue;
      // Must not assign user_id = NULL as part of email update branch
      expect(sql).not.toMatch(/p_email[\s\S]{0,400}user_id\s*:=\s*null/i);
      expect(sql).not.toMatch(/SET\s+user_id\s*=\s*NULL[\s\S]{0,200}p_email/i);
    }
  });

  it('linkModelByEmail is only referenced in allowed legacy AuthContext fallback paths', () => {
    const allowed = new Set(['src/context/AuthContext.tsx', 'src/services/modelsSupabase.ts']);
    const hits: string[] = [];
    function walk(dir: string) {
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) {
          if (ent.name === 'node_modules' || ent.name === '__tests__') continue;
          walk(full);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(ent.name)) continue;
        const rel = path.relative(ROOT, full);
        const content = fs.readFileSync(full, 'utf8');
        if (content.includes('linkModelByEmail')) {
          hits.push(rel);
        }
      }
    }
    walk(path.join(ROOT, 'src'));
    for (const h of hits) {
      expect(allowed.has(h)).toBe(true);
    }
    expect(hits).toContain('src/context/AuthContext.tsx');
    expect(hits).toContain('src/services/modelsSupabase.ts');
  });

  it('generateModelClaimToken uses scoped RPC (not admin_find)', () => {
    const src = readSrc('src/services/modelsSupabase.ts');
    expect(src).toMatch(/generate_model_claim_token/);
    expect(src).not.toMatch(/admin_find_model_by_email/);
  });
});
