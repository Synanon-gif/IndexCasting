import { uiCopy } from '../constants/uiCopy';

export type B2BCalendarChipViewerRole = 'client' | 'agency';

export type B2BCalendarChipKind = 'option' | 'casting' | 'booking';

const PLACEHOLDER_NAMES_LC = new Set(['client', 'agency', 'model']);

function sanitizeOrgDisplayName(value: unknown): string {
  if (typeof value !== 'string') return '';
  const t = value.trim();
  if (!t) return '';
  if (PLACEHOLDER_NAMES_LC.has(t.toLowerCase())) return '';
  return t;
}

/** Project-standard chip separator (em dash + spaces). */
export const B2B_CALENDAR_CHIP_TITLE_SEPARATOR = ' — ';

/**
 * Role-aware B2B calendar chip title — display only.
 * Does not affect color/projection, dedupe, or DB-backed canonical titles.
 */
export function resolveB2BCalendarChipTitle(params: {
  viewerRole: B2BCalendarChipViewerRole;
  modelName?: string | null;
  agencyOrganizationName?: string | null;
  clientOrganizationName?: string | null;
  clientName?: string | null;
  fallbackTitle?: string | null;
  isAgencyOnly?: boolean | null;
  kind?: B2BCalendarChipKind;
}): string {
  void params.kind;
  const model = (params.modelName ?? '').trim();
  const fallback = (params.fallbackTitle ?? '').trim();

  if (params.viewerRole === 'client') {
    if (model) {
      const agency =
        sanitizeOrgDisplayName(params.agencyOrganizationName) || uiCopy.common.unknownAgency;
      return `${model}${B2B_CALENDAR_CHIP_TITLE_SEPARATOR}${agency}`;
    }
    return fallback || uiCopy.common.unknownModel;
  }

  if (params.isAgencyOnly === true) {
    if (model) return model;
    return fallback || uiCopy.common.unknownModel;
  }

  if (model) {
    const client =
      sanitizeOrgDisplayName(params.clientOrganizationName) ||
      sanitizeOrgDisplayName(params.clientName) ||
      uiCopy.common.unknownClient;
    return `${model}${B2B_CALENDAR_CHIP_TITLE_SEPARATOR}${client}`;
  }

  return fallback || uiCopy.common.unknownModel;
}
