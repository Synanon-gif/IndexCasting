/**
 * PostgREST/Supabase returns at most ~1000 rows per request by default.
 * These helpers page with .range() until all matching rows are loaded (no time-based cutoff).
 */
import type { PostgrestError } from '@supabase/supabase-js';

export const SUPABASE_PAGE_SIZE = 1000;

type PageResult<T> = { data: T[] | null; error: PostgrestError | null };

/**
 * Load every page from a query built with consistent filters + order; stops when a page is short.
 */
export async function fetchAllSupabasePages<T>(fetchPage: (from: number, to: number) => Promise<PageResult<T>>): Promise<T[]> {
  const all: T[] = [];
  let from = 0;
  for (;;) {
    const to = from + SUPABASE_PAGE_SIZE - 1;
    const { data, error } = await fetchPage(from, to);
    if (error) {
      console.error('fetchAllSupabasePages:', error);
      return all;
    }
    const rows = data ?? [];
    all.push(...rows);
    if (rows.length < SUPABASE_PAGE_SIZE) break;
    from += SUPABASE_PAGE_SIZE;
  }
  return all;
}
