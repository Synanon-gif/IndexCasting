/**
 * Model profile completeness check.
 *
 * Mandatory fields — a model is NOT properly represented without these:
 *   1. Name (always set in the form, but checked defensively)
 *   2. At least one visible portfolio photo
 *   3. At least one territory of representation
 *
 * Everything else is RECOMMENDED: the model will appear in client discovery
 * and agency My Models even if these fields are missing, but the agency
 * receives an actionable alert to complete the profile.
 *
 * Recommended fields improve discoverability and client-filter matching:
 *   - height (used in measurement filters)
 *   - country_code (supplements territory for direct location lookup)
 *   - visibility flags (both false = hidden from all client views)
 *   - email (needed to link model app account)
 *   - chest / bust, waist, hips measurements
 *   - legs_inseam, shoe_size
 *   - hair_color, eye_color
 *   - sex, ethnicity
 */

import type { SupabaseModel } from '../services/modelsSupabase';

export type CompletenessIssue = {
  field: string;
  label: string;
  severity: 'critical' | 'recommended';
};

export type CompletenessContext = {
  /** True if model_agency_territories has at least one row for this model. */
  hasTerritories: boolean;
  /** True if model_photos has at least one is_visible_to_clients = true entry. */
  hasVisiblePhoto: boolean;
};

/**
 * Returns an array of completeness issues, critical ones first.
 * An empty array means the profile is fully complete.
 *
 * A model is always saved and always appears in agency My Models regardless
 * of these issues. Critical issues only indicate the three mandatory fields
 * (name, photo, territory) are missing. Recommended issues indicate fields
 * that improve discovery and filter matching.
 */
export function checkModelCompleteness(
  model: Partial<SupabaseModel>,
  ctx: CompletenessContext,
): CompletenessIssue[] {
  const issues: CompletenessIssue[] = [];

  // ── Critical — the three mandatory fields ──────────────────────────────────

  if (!model.name?.trim()) {
    issues.push({
      field: 'name',
      label: 'Name is missing — required for all views.',
      severity: 'critical',
    });
  }

  if (!ctx.hasVisiblePhoto) {
    issues.push({
      field: 'portfolio_images',
      label: 'No visible portfolio photo — clients cannot see this model.',
      severity: 'critical',
    });
  }

  if (!ctx.hasTerritories) {
    issues.push({
      field: 'territory',
      label: 'No territory assigned — model will not appear in location-based client discovery.',
      severity: 'critical',
    });
  }

  // ── Recommended — improve discoverability and filter matching ──────────────

  // Both visibility flags off = hidden from all client type queries.
  if (!model.is_visible_fashion && !model.is_visible_commercial) {
    issues.push({
      field: 'visibility',
      label: 'Not visible to any client type (Fashion or Commercial). Assign at least one category or remove all categories to show in both.',
      severity: 'recommended',
    });
  }

  if (!model.height || model.height <= 0) {
    issues.push({
      field: 'height',
      label: 'Height missing — model will be excluded from height-based client filters.',
      severity: 'recommended',
    });
  }

  if (!model.country_code && !ctx.hasTerritories) {
    // Only flag if territory is also missing (territory is already critical above).
    // This entry is intentionally skipped when territory is set.
  } else if (!model.country_code && ctx.hasTerritories) {
    issues.push({
      field: 'country_code',
      label: 'No home country set — model appears via territory only, not direct location lookup.',
      severity: 'recommended',
    });
  }

  if (!model.email) {
    issues.push({
      field: 'email',
      label: 'No email — cannot link model app account (calendar, options, chats).',
      severity: 'recommended',
    });
  }

  const chestVal = model.chest ?? model.bust;
  if (!chestVal) {
    issues.push({
      field: 'chest',
      label: 'Chest / bust measurement missing.',
      severity: 'recommended',
    });
  }

  if (!model.waist) {
    issues.push({
      field: 'waist',
      label: 'Waist measurement missing.',
      severity: 'recommended',
    });
  }

  if (!model.hips) {
    issues.push({
      field: 'hips',
      label: 'Hips measurement missing.',
      severity: 'recommended',
    });
  }

  if (!model.hair_color) {
    issues.push({
      field: 'hair_color',
      label: 'Hair color not set.',
      severity: 'recommended',
    });
  }

  if (!model.eye_color) {
    issues.push({
      field: 'eye_color',
      label: 'Eye color not set.',
      severity: 'recommended',
    });
  }

  if (!model.sex) {
    issues.push({
      field: 'sex',
      label: 'Sex not specified — affects sex-based client filters.',
      severity: 'recommended',
    });
  }

  if (!model.ethnicity) {
    issues.push({
      field: 'ethnicity',
      label: 'Ethnicity not specified — affects diversity filters.',
      severity: 'recommended',
    });
  }

  // Critical issues first, then recommended.
  return issues.sort((a, b) => {
    if (a.severity === b.severity) return 0;
    return a.severity === 'critical' ? -1 : 1;
  });
}

/** Convenience: returns true if the profile has at least one critical issue. */
export function hasBlockingIssues(
  model: Partial<SupabaseModel>,
  ctx: CompletenessContext,
): boolean {
  return checkModelCompleteness(model, ctx).some((i) => i.severity === 'critical');
}
