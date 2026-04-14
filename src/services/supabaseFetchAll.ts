/**
 * PostgREST/Supabase returns at most ~1000 rows per request by default.
 * These helpers page with .range() until all matching rows are loaded (no time-based cutoff).
 */
import type { PostgrestError } from '@supabase/supabase-js';

export const SUPABASE_PAGE_SIZE = 1000;

const DEFAULT_MAX_ROWS = 100_000;

type PageResult<T> = { data: T[] | null; error: PostgrestError | null };

type FetchAllOptions = {
  /**
   * Safety limit: stop fetching after this many total rows.
   * Prevents runaway queries from consuming unbounded memory.
   * Default: 100_000.
   */
  maxRows?: number;
};

/**
 * Load every page from a query built with consistent filters + order; stops when a page is short.
 *
 * Error behaviour: throws on any page error rather than returning a partial silent list.
 * The previous behaviour of returning `all` on error was dangerous: callers could not
 * distinguish a full result set from a truncated one, leading to silent data loss in UIs.
 * All existing callers have try/catch at a higher level that will handle the throw.
 */
export async function fetchAllSupabasePages<T>(
  fetchPage: (from: number, to: number) => Promise<PageResult<T>>,
  opts?: FetchAllOptions,
): Promise<T[]> {
  const maxRows = opts?.maxRows ?? DEFAULT_MAX_ROWS;
  const all: T[] = [];
  let from = 0;
  for (;;) {
    const to = from + SUPABASE_PAGE_SIZE - 1;
    const { data, error } = await fetchPage(from, to);
    if (error) {
      console.error('fetchAllSupabasePages:', error);
      throw error;
    }
    const rows = data ?? [];
    all.push(...rows);

    if (rows.length < SUPABASE_PAGE_SIZE) break;

    if (all.length >= maxRows) {
      console.warn(
        `[fetchAllSupabasePages] reached maxRows limit (${maxRows}). ` +
          `Returning ${all.length} rows — dataset may be truncated.`,
      );
      break;
    }

    from += SUPABASE_PAGE_SIZE;
  }
  return all;
}
