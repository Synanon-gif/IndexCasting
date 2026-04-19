import { colors } from '../theme/theme';
import { uiCopy } from '../constants/uiCopy';

/**
 * Pure helpers for the public Status Page (`/status`).
 *
 * Extracted from `StatusPageView.tsx` so they can be unit-tested without a
 * React renderer. Behaviour is intentionally identical to the inline
 * implementations the view used previously.
 */

export type OverallStatus = 'ok' | 'degraded' | 'outage' | 'unknown';
export type CheckStatus = 'ok' | 'degraded' | 'down' | 'unknown';

export type PublicHealthCheck = {
  name: string;
  display_name: string;
  status: CheckStatus;
  last_run_at: string | null;
};

export type PublicHealthSummary = {
  overall_status: OverallStatus;
  last_updated: string | null;
  checks: PublicHealthCheck[];
};

/** Maps a status enum value to user-facing label copy. */
export function overallLabel(status: OverallStatus | CheckStatus): string {
  if (status === 'ok') return uiCopy.trust.statusOverallOk;
  if (status === 'degraded') return uiCopy.trust.statusOverallDegraded;
  if (status === 'outage' || status === 'down') return uiCopy.trust.statusOverallOutage;
  return uiCopy.trust.statusOverallUnknown;
}

/** Maps a status enum value to a banner / pill background color. */
export function overallColor(status: OverallStatus | CheckStatus): string {
  if (status === 'ok') return colors.successLight;
  if (status === 'degraded') return colors.warning;
  if (status === 'outage' || status === 'down') return colors.error;
  return colors.borderLight;
}

/** Formats an ISO timestamp as a locale-aware "last updated" string; null-safe. */
export function formatLastUpdated(ts: string | null | undefined): string {
  if (!ts) return '—';
  try {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return ts;
    return d.toLocaleString();
  } catch {
    return ts;
  }
}

/**
 * Validates that an arbitrary RPC payload matches the `PublicHealthSummary`
 * shape. Used by `StatusPageView` to fail-safe when the RPC is not deployed
 * yet or returns an unexpected shape.
 */
export function isPublicHealthSummary(payload: unknown): payload is PublicHealthSummary {
  if (!payload || typeof payload !== 'object') return false;
  const obj = payload as Record<string, unknown>;
  if (!('overall_status' in obj)) return false;
  if (!('checks' in obj)) return false;
  if (!Array.isArray(obj.checks)) return false;
  return true;
}
