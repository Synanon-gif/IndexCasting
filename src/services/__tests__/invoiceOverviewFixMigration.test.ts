/**
 * Static contract tests for the invoice overview production-fix migration.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const FIX_PATH = join(
  __dirname,
  '../../../supabase/migrations/20260430140000_invoice_overview_audit_fix_and_list_enrichment.sql',
);

const sql = readFileSync(FIX_PATH, 'utf-8');

describe('invoice_overview fix migration — audit_trail insert', () => {
  it('writes audit rows using org_id (audit_trail has no organization_id)', () => {
    expect(sql).toMatch(/INSERT INTO public\.audit_trail \(\s*org_id,/);
    expect(sql).not.toMatch(/INSERT INTO public\.audit_trail \(\s*organization_id,/);
  });
});

describe('invoice_overview fix migration — list_invoice_overview enrichment', () => {
  it('replaces list_invoice_overview when OUT columns change (DROP + CREATE)', () => {
    expect(sql).toMatch(
      /DROP FUNCTION IF EXISTS public\.list_invoice_overview\(uuid, int, int, text, text, text, text, int, int\)/,
    );
    expect(sql).toMatch(/CREATE FUNCTION public\.list_invoice_overview\(/);
  });

  it('sanitizes Stripe URLs via a dedicated immutable helper', () => {
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.fn_invoice_overview_safe_stripe_https_url/,
    );
    expect(sql).toMatch(/fn_invoice_overview_safe_stripe_https_url\(i\.stripe_hosted_url\)/);
    expect(sql).toMatch(/fn_invoice_overview_safe_stripe_https_url\(i\.stripe_pdf_url\)/);
  });

  it('does not expose raw Stripe invoice IDs or payment intents in the projection', () => {
    const fnMatch = sql.match(/CREATE FUNCTION public\.list_invoice_overview[\s\S]*?\$\$;/);
    expect(fnMatch).toBeTruthy();
    const body = fnMatch![0];
    expect(body).not.toMatch(
      /\bstripe_invoice_id\b|\bstripe_payment_intent\b|\bstripe_customer\b/i,
    );
  });
});
