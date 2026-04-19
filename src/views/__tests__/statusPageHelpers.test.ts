import {
  overallLabel,
  overallColor,
  formatLastUpdated,
  isPublicHealthSummary,
  type PublicHealthSummary,
} from '../statusPageHelpers';
import { uiCopy } from '../../constants/uiCopy';
import { colors } from '../../theme/theme';

/**
 * Smoke / contract tests for the public Status Page helpers.
 *
 * These cover the pure logic that backs `/status`: status → label, status →
 * color, ISO timestamp formatting, and validation of the
 * `get_public_health_summary` RPC payload shape. Live deployment of the RPC
 * itself is verified separately by `scripts/observability-verify.sh`.
 *
 * No React renderer is used — the StatusPageView component pulls from these
 * helpers, so verifying their behaviour here is sufficient to catch the
 * regressions we care about (wrong copy key, wrong color bucket, malformed
 * RPC payload silently rendered).
 */

describe('statusPageHelpers / overallLabel', () => {
  it('maps each status enum to the matching uiCopy key', () => {
    expect(overallLabel('ok')).toBe(uiCopy.trust.statusOverallOk);
    expect(overallLabel('degraded')).toBe(uiCopy.trust.statusOverallDegraded);
    expect(overallLabel('outage')).toBe(uiCopy.trust.statusOverallOutage);
    expect(overallLabel('down')).toBe(uiCopy.trust.statusOverallOutage);
    expect(overallLabel('unknown')).toBe(uiCopy.trust.statusOverallUnknown);
  });
});

describe('statusPageHelpers / overallColor', () => {
  it('returns successLight for ok', () => {
    expect(overallColor('ok')).toBe(colors.successLight);
  });

  it('returns warning for degraded', () => {
    expect(overallColor('degraded')).toBe(colors.warning);
  });

  it('returns error for outage and down', () => {
    expect(overallColor('outage')).toBe(colors.error);
    expect(overallColor('down')).toBe(colors.error);
  });

  it('returns borderLight for unknown', () => {
    expect(overallColor('unknown')).toBe(colors.borderLight);
  });
});

describe('statusPageHelpers / formatLastUpdated', () => {
  it('returns em-dash for null/undefined/empty', () => {
    expect(formatLastUpdated(null)).toBe('—');
    expect(formatLastUpdated(undefined)).toBe('—');
    expect(formatLastUpdated('')).toBe('—');
  });

  it('returns a non-empty locale string for valid ISO timestamps', () => {
    const out = formatLastUpdated('2026-04-19T12:34:56.000Z');
    expect(typeof out).toBe('string');
    expect(out.length).toBeGreaterThan(0);
    expect(out).not.toBe('—');
  });

  it('returns the raw input for unparseable strings (fail-soft)', () => {
    expect(formatLastUpdated('not-a-date')).toBe('not-a-date');
  });
});

describe('statusPageHelpers / isPublicHealthSummary (RPC payload contract)', () => {
  it('accepts a well-formed summary with checks array', () => {
    const sample: PublicHealthSummary = {
      overall_status: 'ok',
      last_updated: '2026-04-19T12:00:00.000Z',
      checks: [
        {
          name: 'orphan_calendar_entries',
          display_name: 'Orphan calendar entries',
          status: 'ok',
          last_run_at: '2026-04-19T11:55:00.000Z',
        },
      ],
    };
    expect(isPublicHealthSummary(sample)).toBe(true);
  });

  it('accepts an empty checks array (cold-start state)', () => {
    expect(
      isPublicHealthSummary({
        overall_status: 'unknown',
        last_updated: null,
        checks: [],
      }),
    ).toBe(true);
  });

  it('rejects null / undefined / non-objects', () => {
    expect(isPublicHealthSummary(null)).toBe(false);
    expect(isPublicHealthSummary(undefined)).toBe(false);
    expect(isPublicHealthSummary('string')).toBe(false);
    expect(isPublicHealthSummary(42)).toBe(false);
  });

  it('rejects payloads missing required fields', () => {
    expect(isPublicHealthSummary({ overall_status: 'ok' })).toBe(false);
    expect(isPublicHealthSummary({ checks: [] })).toBe(false);
  });

  it('rejects payloads where checks is not an array', () => {
    expect(
      isPublicHealthSummary({
        overall_status: 'ok',
        checks: { not: 'array' },
      }),
    ).toBe(false);
  });
});
