/**
 * Regression fence: Axis-1 price negotiation MUST stay actionable when
 * status='confirmed' (model approved availability). This class of bug recurred
 * when UI/services/RPCs gated on status === 'in_negotiation' only.
 *
 * Do not remove or weaken without equivalent replacement tests.
 */
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.join(__dirname, '../../..');
const MIGRATIONS_DIR = path.join(ROOT, 'supabase/migrations');

function readSrc(relativePath: string): string {
  const full = path.join(ROOT, relativePath);
  expect(fs.existsSync(full)).toBe(true);
  return fs.readFileSync(full, 'utf8');
}

function latestMigrationDefining(
  predicate: (sql: string) => boolean,
): { file: string; sql: string } | null {
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  let last: { file: string; sql: string } | null = null;
  for (const file of files) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    if (predicate(sql)) last = { file, sql };
  }
  return last;
}

function definesAgencySetCounterOffer(sql: string): boolean {
  return /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.agency_set_counter_offer\s*\(/is.test(sql);
}

function definesAgencyConfirmClientPrice(sql: string): boolean {
  return /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.agency_confirm_client_price\s*\(/is.test(sql);
}

/** Both RPCs must allow price actions while availability row is status=confirmed. */
function allowsConfirmedStatusForPrice(sql: string): boolean {
  return (
    /status\s+IN\s*\(\s*'in_negotiation'\s*,\s*'confirmed'\s*\)/is.test(sql) ||
    /status\s+IN\s*\(\s*'confirmed'\s*,\s*'in_negotiation'\s*\)/is.test(sql)
  );
}

const CANONICAL_AGENCY_PRICE_MIGRATION =
  '20261328_agency_price_rpcs_post_availability_confirmed.sql';

/** Latest redefine of agency price RPCs (casting guard + confirmed-status parity). */
const LATEST_AGENCY_PRICE_RPC_MIGRATION = '20261331_casting_block_price_negotiation_rpcs.sql';

describe('negotiation price flow — migration regression guard', () => {
  it('canonical migration exists', () => {
    expect(fs.existsSync(path.join(MIGRATIONS_DIR, CANONICAL_AGENCY_PRICE_MIGRATION))).toBe(true);
  });

  it('latest agency_set_counter_offer allows in_negotiation OR confirmed', () => {
    const latest = latestMigrationDefining(definesAgencySetCounterOffer);
    expect(latest).not.toBeNull();
    expect(latest!.file).toBe(LATEST_AGENCY_PRICE_RPC_MIGRATION);
    expect(allowsConfirmedStatusForPrice(latest!.sql)).toBe(true);
    expect(latest!.sql).toMatch(/awaiting_client_response/i);
    expect(latest!.sql).toMatch(/price_negotiation_not_applicable_for_casting/i);
  });

  it('latest agency_confirm_client_price allows in_negotiation OR confirmed', () => {
    const latest = latestMigrationDefining(definesAgencyConfirmClientPrice);
    expect(latest).not.toBeNull();
    expect(latest!.file).toBe(LATEST_AGENCY_PRICE_RPC_MIGRATION);
    expect(allowsConfirmedStatusForPrice(latest!.sql)).toBe(true);
    expect(latest!.sql).toMatch(/request_type::text,\s*'option'\)\s*<>\s*'casting'/i);
  });

  it('every non-legacy agency_set_counter_offer redefinition allows confirmed status', () => {
    const LEGACY_ONLY_IN_NEGOTIATION = new Set<string>([
      '20260818_atomic_agency_set_counter_offer.sql',
    ]);

    const violations: string[] = [];
    for (const file of fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort()) {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      if (!definesAgencySetCounterOffer(sql)) continue;
      if (LEGACY_ONLY_IN_NEGOTIATION.has(file)) continue;
      if (!allowsConfirmedStatusForPrice(sql)) violations.push(file);
    }
    expect(violations).toEqual([]);
  });
});

describe('negotiation price flow — service regression guard', () => {
  it('agencyRejectClientPrice allows status in_negotiation OR confirmed', () => {
    const src = readSrc('src/services/optionRequestsSupabase.ts');
    const fnBlock = src.slice(
      src.indexOf('export async function agencyRejectClientPrice'),
      src.indexOf('export async function', src.indexOf('agencyRejectClientPrice') + 1),
    );
    expect(fnBlock).toMatch(
      /\.in\s*\(\s*['"]status['"]\s*,\s*\[\s*['"]in_negotiation['"]\s*,\s*['"]confirmed['"]\s*\]\s*\)/,
    );
  });

  it('setAgencyCounterOffer documents confirmed-status RPC (not direct UPDATE guard)', () => {
    const src = readSrc('src/services/optionRequestsSupabase.ts');
    expect(src).toMatch(/agency_set_counter_offer.*20261328/s);
    expect(src).toMatch(/in_negotiation or confirmed/i);
  });
});

describe('negotiation price flow — UI regression guard', () => {
  it('NegotiationThreadFooter uses D1 helpers (not status-only gates) for price CTAs', () => {
    const footer = readSrc('src/components/optionNegotiation/NegotiationThreadFooter.tsx');
    expect(footer).toMatch(/shouldShowClientAcceptCounterAction/);
    expect(footer).toMatch(/shouldShowAgencySendCounterOffer/);
    expect(footer).toMatch(/shouldShowAgencyAcceptDeclineProposedFee/);
    // Client accept must not be tied to legacy negotiationOpen heuristic.
    expect(footer).not.toMatch(/showClientAcceptCounter\s*=\s*[^;]*negotiationOpen/);
  });

  it('ClientWebApp keeps NegotiationThreadFooter in footerTop on desktop (agency parity)', () => {
    const src = readSrc('src/web/ClientWebApp.tsx');
    expect(src).toMatch(/footerTop=\{\s*\n?\s*<NegotiationThreadFooter/);
    expect(src).not.toMatch(/showDesktopNegotiationRail\s*&&\s*isAgency\s*\?\s*null/);
    expect(src).not.toMatch(/isAgency\s*\?\s*null\s*:\s*\(\s*\n?\s*<NegotiationThreadFooter/);
  });

  it('AgencyControllerView keeps NegotiationThreadFooter in footerTop on desktop', () => {
    const src = readSrc('src/views/AgencyControllerView.tsx');
    expect(src).toMatch(/footerTop=\{\s*\n?\s*<NegotiationThreadFooter/);
    expect(src).not.toMatch(/showDesktopNegotiationRail\s*&&\s*isAgency\s*\?\s*null/);
  });

  it('ActiveOptionsView uses attention pipeline for action-required badge', () => {
    const src = readSrc('src/web/ClientWebApp.tsx');
    const activeOptionsBlock = src.slice(
      src.indexOf('const ActiveOptionsView'),
      src.indexOf('const ActiveOptionsView') + 8000,
    );
    expect(activeOptionsBlock).toMatch(/attentionHeaderLabelFromSignals/);
    expect(activeOptionsBlock).toMatch(/smartAttentionLabel/);
  });
});

describe('negotiation price flow — helper module contracts', () => {
  it('negotiationAgencyPriceActions documents confirmed-status independence', () => {
    const src = readSrc('src/utils/negotiationAgencyPriceActions.ts');
    expect(src).toMatch(/Independent of status === 'in_negotiation'/);
  });

  it('negotiationClientCounterActions documents confirmed-status independence', () => {
    const src = readSrc('src/utils/negotiationClientCounterActions.ts');
    expect(src).toMatch(/Independent of status === 'in_negotiation'/);
    expect(src).toMatch(/status === 'in_negotiation' \|\| status === 'confirmed'/);
  });

  it('parity test suite exists (multi-round confirmed lifecycles)', () => {
    expect(fs.existsSync(path.join(__dirname, 'negotiationPriceFlowParity.test.ts'))).toBe(true);
  });
});
