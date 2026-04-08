import { getModelByIdFromSupabase } from './modelsSupabase';

/**
 * Simuliert einen Mediaslide-API-Call für ein Model.
 * Liest jetzt aus Supabase statt mockData.
 * Discovery parity: polaroids never exposed here (same as getModelData) — use package flows for polaroids.
 */
export async function fetchModelFromMediaslide(id) {
  const base = await getModelByIdFromSupabase(id);

  if (!base) {
    return null;
  }

  return {
    id: base.id,
    name: base.name,
    measurements: {
      height: base.height,
      bust: base.bust,
      waist: base.waist,
      hips: base.hips,
    },
    portfolio: {
      images: base.portfolio_images || [],
      polaroids: [],
    },
    calendar: {
      blocked: ['2026-03-21', '2026-03-22'],
      available: ['2026-03-23', '2026-03-24', '2026-03-25'],
    },
  };
}
