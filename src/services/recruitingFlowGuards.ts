/**
 * Client-side guards and verification for application → represented model flow.
 * DB remains source of truth; these calls add observability and post-RPC checks (RLS-safe reads).
 *
 * Reactivation after **ended** representation: `create_model_from_accepted_application` (migration
 * `20260828_recruiting_model_conversion_and_direct_conversation.sql`) sets `agency_relationship_status`
 * back to `active` and merges MAT; use `hasMatForModelAgency` after confirm for defense-in-depth.
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
