/**
 * Agency Storage Tracking Service.
 *
 * All reads and writes go through SECURITY DEFINER RPCs — normal users
 * never touch the organization_storage_usage table directly.
 *
 * Storage limit applies ONLY to agency organizations.
 * Clients and models are unrestricted (RPC returns allowed: true for them).
 *
 * Pattern mirrors agencyUsageLimitsSupabase.ts (swipe limits).
 */
import { supabase } from '../../lib/supabase';
import { logger } from '../utils/logger';

/** 10 GB (Agency Basic default) in bytes — fallback when RPC omits limit_bytes. */
export const AGENCY_STORAGE_LIMIT_BYTES = 10 * 1024 * 1024 * 1024; // 10_737_418_240

export interface AgencyStorageUsage {
  organization_id: string;
  used_bytes: number;
  /** Effective limit in bytes. Equals the custom limit when set, otherwise plan default (Basic: 10 GB).
   *  null when is_unlimited = true — do not use for math in that case. */
  effective_limit_bytes: number | null;
  /** Kept for backward compatibility — mirrors effective_limit_bytes (plan default when unlimited). */
  limit_bytes: number;
  /** When true the organization has no storage cap. */
  is_unlimited: boolean;
}

export interface StorageCheckResult {
  allowed: boolean;
  used_bytes: number;
  limit_bytes: number;
  is_unlimited?: boolean;
  error?: string;
}

export interface ChatThreadFilePath {
  file_url: string;
  path: string;
  size_bytes: number;
}

export interface ModelPortfolioFilePath {
  photo_id: string;
  url: string;
  bucket: 'documents' | 'documentspictures';
  path: string | null;
  size_bytes: number;
}

// ─── Read ──────────────────────────────────────────────────────────────────────

/**
 * Returns the current storage snapshot for the caller's agency organization.
 * Returns null if the user is not part of an agency org or on network error.
 *
 * The returned object includes:
 *   - used_bytes: current usage
 *   - effective_limit_bytes: null when unlimited, otherwise the active cap
 *   - limit_bytes: backward-compat alias (plan default when unlimited)
 *   - is_unlimited: true when the org has no storage cap
 */
export async function getMyAgencyStorageUsage(): Promise<AgencyStorageUsage | null> {
  try {
    const { data, error } = await supabase.rpc('get_my_agency_storage_usage');
    if (error) throw error;
    if (!data || (data as { error?: string }).error) return null;

    const raw = data as {
      organization_id: string;
      used_bytes: number;
      limit_bytes: number;
      effective_limit_bytes: number | null;
      is_unlimited: boolean;
    };

    return {
      organization_id: raw.organization_id,
      used_bytes: raw.used_bytes ?? 0,
      effective_limit_bytes: raw.effective_limit_bytes ?? null,
      limit_bytes: raw.limit_bytes ?? AGENCY_STORAGE_LIMIT_BYTES,
      is_unlimited: raw.is_unlimited ?? false,
    };
  } catch (err) {
    console.error('[agencyStorage] getMyAgencyStorageUsage error:', err);
    return null;
  }
}

// ─── Upload Guard ──────────────────────────────────────────────────────────────

/**
 * Atomically checks the agency storage limit and increments used_bytes if allowed.
 * MUST be called before every upload in agency upload services.
 *
 * On any unexpected DB error the function fails CLOSED (allowed: false)
 * to ensure the storage limit is never silently bypassed.
 *
 * Non-agency users (clients, models) receive allowed: true automatically
 * — the RPC itself handles this distinction.
 */
export async function checkAndIncrementStorage(fileSize: number): Promise<StorageCheckResult> {
  try {
    const { data, error } = await supabase.rpc('increment_agency_storage_usage', {
      p_bytes: fileSize,
    });
    if (error) throw error;
    return data as StorageCheckResult;
  } catch (err) {
    console.error('[agencyStorage] checkAndIncrementStorage error:', err);
    logger.error(
      'agencyStorage',
      'checkAndIncrementStorage failed — fail closed (upload blocked)',
      {
        message: err instanceof Error ? err.message : String(err),
        fileSize,
      },
    );
    return {
      allowed: false,
      used_bytes: 0,
      limit_bytes: AGENCY_STORAGE_LIMIT_BYTES,
      error: 'Storage check failed. Please try again.',
    };
  }
}

// ─── Delete / Rollback ─────────────────────────────────────────────────────────

/**
 * Decrements used_bytes after a successful file deletion.
 * Also used as a rollback when an upload fails after the pre-increment.
 * Safe to call with 0 or negative values — the RPC floors at 0.
 */
export async function decrementStorage(fileSize: number): Promise<void> {
  if (fileSize <= 0) return;
  try {
    const { error } = await supabase.rpc('decrement_agency_storage_usage', {
      p_bytes: fileSize,
    });
    if (error) throw error;
  } catch (err) {
    console.error('[agencyStorage] decrementStorage error:', err);
    logger.warn('agencyStorage', 'decrementStorage failed — quota may drift', {
      message: err instanceof Error ? err.message : String(err),
      fileSize,
    });
  }
}

// ─── Bulk Delete: Chat Thread ──────────────────────────────────────────────────

/**
 * Deletes all media files in a conversation thread and updates storage usage.
 *
 * Flow:
 *  1. RPC returns all file paths + sizes for the conversation.
 *  2. Storage API removes the files.
 *  3. used_bytes is decremented by the total size of successfully deleted files.
 *  4. Returns { deletedCount, freedBytes }.
 *
 * Only agency members may call this (enforced by the RPC).
 */
export async function deleteChatThreadWithFiles(conversationId: string): Promise<{
  deletedCount: number;
  freedBytes: number;
}> {
  const result = { deletedCount: 0, freedBytes: 0 };
  try {
    const { data, error } = await supabase.rpc('get_chat_thread_file_paths', {
      p_conversation_id: conversationId,
    });
    if (error) throw error;

    const files = (data ?? []) as ChatThreadFilePath[];
    if (files.length === 0) return result;

    const validPaths = files.map((f) => f.path).filter((p): p is string => Boolean(p && p.trim()));

    if (validPaths.length > 0) {
      const { error: storageError } = await supabase.storage.from('chat-files').remove(validPaths);
      if (storageError) {
        console.error('[agencyStorage] deleteChatThreadWithFiles storage error:', storageError);
      }
    }

    const totalBytes = files.reduce((sum, f) => sum + (f.size_bytes ?? 0), 0);
    if (totalBytes > 0) {
      await decrementStorage(totalBytes);
    }

    result.deletedCount = validPaths.length;
    result.freedBytes = totalBytes;
    return result;
  } catch (err) {
    console.error('[agencyStorage] deleteChatThreadWithFiles error:', err);
    return result;
  }
}

// ─── Bulk Delete: Model Portfolio ─────────────────────────────────────────────

/**
 * Deletes all storage-backed photos for a model and updates storage usage.
 *
 * Flow:
 *  1. RPC returns all file paths + sizes per bucket.
 *  2. Storage API removes files from each bucket.
 *  3. used_bytes is decremented by the total freed bytes.
 *  4. Returns { deletedCount, freedBytes }.
 *
 * Only agency members may call this (enforced by the RPC).
 */
export async function deleteModelPortfolioFiles(modelId: string): Promise<{
  deletedCount: number;
  freedBytes: number;
}> {
  const result = { deletedCount: 0, freedBytes: 0 };
  try {
    const { data, error } = await supabase.rpc('get_model_portfolio_file_paths', {
      p_model_id: modelId,
    });
    if (error) throw error;

    const files = (data ?? []) as ModelPortfolioFilePath[];
    if (files.length === 0) return result;

    const pathsByBucket = new Map<string, string[]>();
    for (const f of files) {
      if (!f.path) continue;
      const existing = pathsByBucket.get(f.bucket) ?? [];
      existing.push(f.path);
      pathsByBucket.set(f.bucket, existing);
    }

    for (const [bucket, paths] of pathsByBucket.entries()) {
      if (paths.length === 0) continue;
      const { error: storageError } = await supabase.storage.from(bucket).remove(paths);
      if (storageError) {
        console.error(
          `[agencyStorage] deleteModelPortfolioFiles storage error (bucket: ${bucket}):`,
          storageError,
        );
      }
    }

    const totalBytes = files.reduce((sum, f) => sum + (f.size_bytes ?? 0), 0);
    if (totalBytes > 0) {
      await decrementStorage(totalBytes);
    }

    result.deletedCount = files.filter((f) => f.path).length;
    result.freedBytes = totalBytes;
    return result;
  } catch (err) {
    console.error('[agencyStorage] deleteModelPortfolioFiles error:', err);
    return result;
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Formats a byte count to a human-readable string.
 * Examples: 0 → "0 B", 1536 → "1.5 KB", 10737418240 → "10.0 GB"
 */
export function formatStorageBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const val = bytes / Math.pow(1024, i);
  const decimals = i === 0 ? 0 : 1;
  return `${val.toFixed(decimals)} ${units[i]}`;
}

/**
 * Returns the storage usage percentage as a number between 0 and 100.
 */
export function getStorageUsagePercent(usedBytes: number, limitBytes: number): number {
  if (limitBytes <= 0) return 0;
  return Math.min(100, (usedBytes / limitBytes) * 100);
}
