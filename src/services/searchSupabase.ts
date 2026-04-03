/**
 * Global search service.
 *
 * Calls the search_global SECURITY DEFINER RPC which verifies org-membership
 * before querying. Results are scoped to the caller's organization.
 * Minimum query length: 2 characters (enforced in RPC).
 */
import { supabase } from '../../lib/supabase';

export interface SearchModel {
  id: string;
  name: string;
  mediaslide_id: string | null;
  city: string | null;
  country: string | null;
}

export interface SearchOptionRequest {
  id: string;
  model_name: string | null;
  status: string;
  final_status: string | null;
  requested_date: string | null;
  role: string | null;
}

export interface SearchConversation {
  id: string;
  title: string | null;
  last_message: string | null;
}

export interface GlobalSearchResult {
  models: SearchModel[];
  option_requests: SearchOptionRequest[];
  conversations: SearchConversation[];
}

const EMPTY_RESULT: GlobalSearchResult = {
  models: [],
  option_requests: [],
  conversations: [],
};

/**
 * Searches models, option requests, and conversations for the caller's org.
 * Returns empty result on error or if query is too short.
 * @param limit Max results per category (1–20, default 5, enforced server-side).
 */
export async function searchGlobal(
  query: string,
  orgId: string,
  limit = 5,
): Promise<GlobalSearchResult> {
  if (!query || query.trim().length < 2) return EMPTY_RESULT;

  try {
    const { data, error } = await supabase.rpc('search_global', {
      p_query: query.trim(),
      p_org_id: orgId,
      p_limit: Math.max(1, Math.min(limit, 20)),
    });
    if (error) throw error;
    const result = data as GlobalSearchResult;
    return {
      models: result?.models ?? [],
      option_requests: result?.option_requests ?? [],
      conversations: result?.conversations ?? [],
    };
  } catch (err) {
    console.error('[searchSupabase] searchGlobal error:', err);
    return EMPTY_RESULT;
  }
}
