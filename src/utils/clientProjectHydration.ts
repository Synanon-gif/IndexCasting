import type { SupabaseModel } from '../services/modelsSupabase';
import { normalizeDocumentspicturesModelImageRef } from './normalizeModelPortfolioUrl';

/**
 * Minimal model card shape for client project lists / shared selection.
 * Kept aligned with ClientWebApp `ModelSummary` for project flows.
 */
export type ClientProjectModelSummary = {
  id: string;
  name: string;
  city: string;
  hairColor: string;
  height: number;
  bust: number;
  waist: number;
  hips: number;
  chest: number;
  legsInseam: number;
  coverUrl: string;
  agencyId?: string | null;
  agencyName?: string | null;
  countryCode?: string | null;
  hasRealLocation?: boolean;
  isSportsWinter?: boolean;
  isSportsSummer?: boolean;
  sex?: 'male' | 'female' | null;
};

export type MapClientProjectSummaryOpts = {
  /** From batched model_locations read (live>current>agency); overrides models.city for display parity with Discover. */
  effectiveDisplayCity?: string | null;
};

/** Maps a `models` row (client-visible select) to the project UI summary shape. */
export function mapSupabaseModelToClientProjectSummary(
  m: SupabaseModel,
  opts?: MapClientProjectSummaryOpts,
): ClientProjectModelSummary {
  const firstImg = m.portfolio_images?.[0] ?? '';
  const cc = m.country_code ?? null;
  const city =
    (opts?.effectiveDisplayCity?.trim() ||
      m.effective_city?.trim() ||
      m.city ||
      '').trim() || '';
  return {
    id: m.id,
    name: m.name,
    city,
    hairColor: m.hair_color ?? '',
    height: m.height,
    bust: m.bust ?? 0,
    waist: m.waist ?? 0,
    hips: m.hips ?? 0,
    chest: m.chest ?? m.bust ?? 0,
    legsInseam: m.legs_inseam ?? 0,
    coverUrl: firstImg ? normalizeDocumentspicturesModelImageRef(firstImg, m.id) : '',
    agencyId: m.agency_id ?? null,
    agencyName: null,
    countryCode: cc,
    hasRealLocation: !!cc,
    isSportsWinter: m.is_sports_winter ?? false,
    isSportsSummer: m.is_sports_summer ?? false,
    sex: m.sex ?? null,
  };
}
