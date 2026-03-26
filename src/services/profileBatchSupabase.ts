import { supabase } from '../../lib/supabase';

const PROFILE_IN_CHUNK = 200;

/** Display names for chat / directory lists (batch; chunked for large orgs). */
export async function getProfileDisplayNamesForUserIds(userIds: string[]): Promise<Record<string, string>> {
  const uniq = [...new Set(userIds.filter(Boolean))];
  if (uniq.length === 0) return {};
  const map: Record<string, string> = {};
  try {
    for (let i = 0; i < uniq.length; i += PROFILE_IN_CHUNK) {
      const chunk = uniq.slice(i, i + PROFILE_IN_CHUNK);
      const { data, error } = await supabase.from('profiles').select('id, display_name').in('id', chunk);
      if (error) {
        console.error('getProfileDisplayNamesForUserIds error:', error);
        continue;
      }
      for (const p of data ?? []) {
        const row = p as { id: string; display_name: string | null };
        map[row.id] = row.display_name?.trim() || row.id.slice(0, 8);
      }
    }
    return map;
  } catch (e) {
    console.error('getProfileDisplayNamesForUserIds exception:', e);
    return map;
  }
}
