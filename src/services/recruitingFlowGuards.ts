/**
 * Client-side guards and verification for application → represented model flow.
 * DB remains source of truth; these calls add observability and post-RPC checks (RLS-safe reads).
 */
import { supabase } from '../../lib/supabase';

/** Normalize `model_applications.pending_territories` (jsonb array of ISO codes). */
export function normalizePendingTerritories(raw: unknown): string[] {
  if (raw == null) return [];
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    .map((x) => x.trim().toUpperCase());
}

/**
 * Returns true if at least one MAT row exists for this model and agency.
 */
export async function hasMatForModelAgency(modelId: string, agencyId: string): Promise<boolean> {
  if (!modelId?.trim() || !agencyId?.trim()) {
    console.error('hasMatForModelAgency: missing modelId or agencyId');
    return false;
  }
  try {
    const { data, error } = await supabase
      .from('model_agency_territories')
      .select('id')
      .eq('model_id', modelId)
      .eq('agency_id', agencyId)
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error('hasMatForModelAgency error:', error);
      return false;
    }
    return Boolean(data?.id);
  } catch (e) {
    console.error('hasMatForModelAgency exception:', e);
    return false;
  }
}
