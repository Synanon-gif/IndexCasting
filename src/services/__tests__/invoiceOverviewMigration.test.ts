/**
 * Smoke / safety tests for the Invoice Overview migration.
 *
 * These tests do NOT execute SQL. They guard the static contract of the
 * migration file so future edits cannot silently weaken its security or
 * additivity guarantees.
 *
 * What we lock in:
 *   - File exists and contains the expected DDL surface.
 *   - SECURITY DEFINER RPCs are membership-guarded.
 *   - No service_role / bypass tokens / dangerous patterns.
 *   - No DROP TABLE / DROP COLUMN / ALTER TABLE on existing source tables.
 *   - No INSERT/UPDATE/DELETE inside the read RPC.
 *   - All dynamic input is validated through whitelists.
 *   - GRANT EXECUTE only to authenticated; nothing to anon/public.
 *   - Cleanup triggers cascade overlay rows when source rows are deleted.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const MIGRATION_PATH = join(
  __dirname,
  '../../../supabase/migrations/20261219_invoice_overview_metadata_and_unified_listing.sql',
);

const sql = readFileSync(MIGRATION_PATH, 'utf-8');

describe('Invoice Overview migration — structural contract', () => {
  it('creates the metadata table with safe constraints', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.invoice_overview_metadata/);
    expect(sql).toMatch(/CONSTRAINT invoice_overview_metadata_source_type_chk/);
    expect(sql).toMatch(/CHECK \(source_type IN \('system', 'manual'\)\)/);
    expect(sql).toMatch(/CONSTRAINT invoice_overview_metadata_note_len_chk/);
    expect(sql).toMatch(/CHECK \(internal_note IS NULL OR length\(internal_note\) <= 1000\)/);
    expect(sql).toMatch(/ALTER TABLE public\.invoice_overview_metadata ENABLE ROW LEVEL SECURITY/);
  });

  it('only adds a SELECT policy for org members on the overlay table (no INSERT/UPDATE/DELETE policies)', () => {
    expect(sql).toMatch(/CREATE POLICY "iom_member_select"\s+ON public\.invoice_overview_metadata/);
    expect(sql).toMatch(/USING \(public\.is_org_member\(organization_id\)\)/);

    // No direct INSERT / UPDATE / DELETE policies — writes go through SECDEF RPCs only.
    expect(sql).not.toMatch(
      /CREATE POLICY "iom_[a-z_]+(insert|update|delete)"[\s\S]*?ON public\.invoice_overview_metadata/i,
    );
  });

  it('declares the tracking status enum with exactly three safe values', () => {
    expect(sql).toMatch(
      /CREATE TYPE public\.invoice_overview_tracking_status AS ENUM \(\s*'open',\s*'paid',\s*'problem'\s*\)/,
    );
  });
});

describe('list_invoice_overview RPC safety', () => {
  it('is SECURITY DEFINER, search_path locked, and authenticated-only', () => {
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.list_invoice_overview\([\s\S]*?SECURITY DEFINER/,
    );
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.list_invoice_overview\([\s\S]*?SET search_path = public/,
    );
    expect(sql).toMatch(
      /REVOKE ALL\s+ON FUNCTION public\.list_invoice_overview\(uuid, int, int, text, text, text, text, int, int\) FROM public, anon/,
    );
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.list_invoice_overview\(uuid, int, int, text, text, text, text, int, int\) TO authenticated/,
    );
  });

  it('rejects unauthenticated callers and unauthorized orgs explicitly', () => {
    expect(sql).toMatch(/IF v_uid IS NULL THEN[\s\S]*?RAISE EXCEPTION 'not_authenticated'/);
    expect(sql).toMatch(
      /IF NOT \(v_is_admin OR v_is_member OR v_is_recipient_owner\) THEN[\s\S]*?RAISE EXCEPTION 'not_authorized'/,
    );
  });

  it('validates enum-style filter inputs with whitelists', () => {
    expect(sql).toMatch(
      /p_direction NOT IN \(\s*'agency_to_client', 'agency_to_model', 'model_to_agency', 'agency_to_agency'\s*\)/,
    );
    expect(sql).toMatch(/p_source_type NOT IN \('system', 'manual'\)/);
    expect(sql).toMatch(/p_tracking_status NOT IN \('open', 'paid', 'problem'\)/);
    expect(sql).toMatch(/p_month < 1 OR p_month > 12/);
  });

  it('caps limit and pagination offset', () => {
    expect(sql).toMatch(/LEAST\(GREATEST\(COALESCE\(p_limit, 100\), 1\), 500\)/);
    expect(sql).toMatch(/GREATEST\(COALESCE\(p_offset, 0\), 0\)/);
  });

  it('mirrors source-table visibility rules in the unified WHERE clause', () => {
    // System-side visibility: member-of-issuer OR recipient-owner with allowed status set.
    expect(sql).toMatch(
      /i\.recipient_organization_id = p_organization_id\s+AND v_is_recipient_owner\s+AND i\.status::text IN \('sent', 'paid', 'overdue', 'void', 'uncollectible'\)/,
    );
    // Manual-side visibility: member of agency org only.
    expect(sql).toMatch(/mi\.agency_organization_id = p_organization_id AND v_is_member/);
  });

  it('does not run any write SQL inside the read RPC', () => {
    const fnMatch = sql.match(
      /CREATE OR REPLACE FUNCTION public\.list_invoice_overview[\s\S]*?\$\$;/,
    );
    expect(fnMatch).toBeTruthy();
    const body = fnMatch![0];
    expect(body).not.toMatch(/\bINSERT INTO\b/);
    expect(body).not.toMatch(/\bUPDATE\s+public\./);
    expect(body).not.toMatch(/\bDELETE\s+FROM\b/);
  });
});

describe('update_invoice_tracking_status RPC safety', () => {
  it('validates source_type, status, and source_id and re-resolves the owning org server-side', () => {
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.update_invoice_tracking_status\([\s\S]*?SECURITY DEFINER/,
    );
    expect(sql).toMatch(
      /IF p_source_type NOT IN \('system', 'manual'\) THEN[\s\S]*?RAISE EXCEPTION 'invalid_source_type'/,
    );
    expect(sql).toMatch(
      /IF p_status NOT IN \('open', 'paid', 'problem'\) THEN[\s\S]*?RAISE EXCEPTION 'invalid_status'/,
    );
    expect(sql).toMatch(
      /v_org := public\.fn_resolve_invoice_owning_org\(p_source_type, p_source_id\);/,
    );
    expect(sql).toMatch(
      /IF NOT \(public\.is_current_user_admin\(\) OR public\.is_org_member\(v_org\)\) THEN[\s\S]*?RAISE EXCEPTION 'not_authorized'/,
    );
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.update_invoice_tracking_status\(text, uuid, text\) TO authenticated/,
    );
    expect(sql).toMatch(
      /REVOKE ALL\s+ON FUNCTION public\.update_invoice_tracking_status\(text, uuid, text\) FROM public, anon/,
    );
  });
});

describe('update_invoice_tracking_note RPC safety', () => {
  it('caps note length, normalizes empty to null, and never logs the note text', () => {
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.update_invoice_tracking_note\([\s\S]*?SECURITY DEFINER/,
    );
    expect(sql).toMatch(/IF length\(v_clean\) > 1000 THEN[\s\S]*?RAISE EXCEPTION 'note_too_long'/);
    expect(sql).toMatch(/IF v_clean = '' THEN[\s\S]*?v_clean := NULL/);
    // Audit log only stores `had_note` / `has_note` / length — not the text.
    expect(sql).toMatch(/jsonb_build_object\('had_note', v_old_note IS NOT NULL\)/);
    expect(sql).toMatch(
      /jsonb_build_object\('has_note', v_clean IS NOT NULL, 'note_length', COALESCE\(length\(v_clean\), 0\)\)/,
    );
  });
});

describe('Migration is purely additive (no destructive changes to existing tables)', () => {
  it('does not drop or alter source-table columns', () => {
    expect(sql).not.toMatch(
      /DROP TABLE\s+public\.(invoices|manual_invoices|invoice_line_items|manual_invoice_line_items)/i,
    );
    expect(sql).not.toMatch(/DROP COLUMN/i);
    expect(sql).not.toMatch(
      /ALTER TABLE\s+public\.(invoices|manual_invoices|invoice_line_items|manual_invoice_line_items)/i,
    );
    expect(sql).not.toMatch(
      /DROP POLICY\s+(?:IF EXISTS\s+)?"[^"]+"\s+ON public\.(?:invoices|manual_invoices|invoice_line_items|manual_invoice_line_items)\b/i,
    );
  });

  it('only extends the audit_trail action_type CHECK constraint additively', () => {
    expect(sql).toMatch(
      /ALTER TABLE public\.audit_trail DROP CONSTRAINT IF EXISTS audit_trail_action_type_check/,
    );
    expect(sql).toMatch(
      /ALTER TABLE public\.audit_trail\s+ADD CONSTRAINT audit_trail_action_type_check CHECK \(action_type IN \(/,
    );
    expect(sql).toMatch(/'invoice_tracking_status_updated'/);
    expect(sql).toMatch(/'invoice_tracking_note_updated'/);
    // Sanity: existing critical billing actions are still present.
    expect(sql).toMatch(/'invoice_draft_created'/);
    expect(sql).toMatch(/'invoice_paid'/);
    expect(sql).toMatch(/'settlement_marked_paid'/);
  });

  it('cleans up overlay rows when source rows are deleted (cascade triggers)', () => {
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.fn_invoice_overview_metadata_cleanup_invoice/,
    );
    expect(sql).toMatch(/DROP TRIGGER IF EXISTS tr_invoices_iom_cleanup ON public\.invoices/);
    expect(sql).toMatch(/AFTER DELETE ON public\.invoices/);
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.fn_invoice_overview_metadata_cleanup_manual/,
    );
    expect(sql).toMatch(
      /DROP TRIGGER IF EXISTS tr_manual_invoices_iom_cleanup ON public\.manual_invoices/,
    );
    expect(sql).toMatch(/AFTER DELETE ON public\.manual_invoices/);
  });
});

describe('Sensitive surface is not exposed by the read RPC return shape', () => {
  it('does not return raw Stripe IDs / hosted URLs / payment intent IDs / bank IBANs / emails', () => {
    const fnMatch = sql.match(
      /CREATE OR REPLACE FUNCTION public\.list_invoice_overview[\s\S]*?\$\$;/,
    );
    expect(fnMatch).toBeTruthy();
    const body = fnMatch![0];
    // Forbidden fields must not appear in the SELECT projection.
    expect(body).not.toMatch(
      /stripe_invoice_id|stripe_hosted_url|stripe_pdf_url|stripe_payment_intent_id|stripe_customer/i,
    );
    expect(body).not.toMatch(/\biban\b|\bbic\b|account_holder/i);
    expect(body).not.toMatch(
      /billing_email|recipient_billing_email|email_recipient|email_message_id/i,
    );
    // `recipient_organization_id` and `source_option_request_id` are referenced
    // ONLY in the internal WHERE / visibility filters of the read RPC — never
    // in the SELECT projection. Lock down the projection: extract everything
    // between the final SELECT and the closing FROM enriched.
    const finalSelectMatch = body.match(/SELECT\s+e\.source_type,[\s\S]*?\s+FROM enriched e/);
    expect(finalSelectMatch).toBeTruthy();
    const projection = finalSelectMatch![0];
    expect(projection).not.toMatch(
      /recipient_organization_id|source_option_request_id|stripe_|payment_intent|email_recipient|email_message_id|\biban\b|\bbic\b/i,
    );
  });

  it('does not use service_role or bypass tokens anywhere in the migration', () => {
    // Strip SQL line comments so a header comment that references "service_role"
    // (e.g. "No service_role grants.") cannot mask actual usage in code.
    const stripped = sql
      .split('\n')
      .map((line) => (line.trimStart().startsWith('--') ? '' : line))
      .join('\n');
    expect(stripped).not.toMatch(/service_role/i);
    expect(stripped).not.toMatch(/bypass_rls/i);
    expect(stripped).not.toMatch(/\bSET ROLE\b/i);
  });
});
