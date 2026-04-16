/**
 * Read-only diagnostics for model ↔ auth link drift. Never mutates or auto-links.
 * Full check (email vs auth.users) requires platform admin — uses admin_detect_model_link_inconsistencies RPC.
 */
import { supabase } from '../../lib/supabase';
import { isCurrentUserAdmin } from '../services/adminSupabase';

export type ModelLinkInconsistencyResult = {
  checked: boolean;
  inconsistent: boolean;
  reasons: string[];
  authUserId?: string;
};

function parseRpcJson(data: unknown): Record<string, unknown> | null {
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    return data as Record<string, unknown>;
  }
  return null;
}

/**
 * Admin-only: logs console.error when a true inconsistency is found (email matches auth user, user_id NULL).
 * Non-admin callers get checked=false without performing auth.users lookup.
 */
export async function detectModelLinkInconsistencies(
  modelId: string,
): Promise<ModelLinkInconsistencyResult> {
  if (!modelId?.trim()) {
    return { checked: false, inconsistent: false, reasons: ['missing_model_id'] };
  }

  const admin = await isCurrentUserAdmin();
  if (!admin) {
    return {
      checked: false,
      inconsistent: false,
      reasons: ['admin_only — auth.users comparison not performed'],
    };
  }

  try {
    const { data, error } = await supabase.rpc('admin_detect_model_link_inconsistencies', {
      p_model_id: modelId,
    });
    if (error) {
      console.error('detectModelLinkInconsistencies RPC error:', error);
      return { checked: false, inconsistent: false, reasons: ['rpc_error'] };
    }
    const row = parseRpcJson(data);
    const inconsistent = row?.inconsistent === true;
    const reasonsRaw = row?.reasons;
    const reasons: string[] = Array.isArray(reasonsRaw)
      ? reasonsRaw.filter((x): x is string => typeof x === 'string')
      : [];
    const authUserId = typeof row?.auth_user_id === 'string' ? row.auth_user_id : undefined;

    if (inconsistent) {
      console.error('[detectModelLinkInconsistencies]', {
        modelId,
        reasons,
        authUserId,
      });
    }

    return { checked: true, inconsistent, reasons, authUserId };
  } catch (e) {
    console.error('detectModelLinkInconsistencies exception:', e);
    return { checked: false, inconsistent: false, reasons: ['exception'] };
  }
}

export type OrphanedModelRowsResult = {
  checked: boolean;
  orphanCount: number;
  sampleModelIds: string[];
};

/** Admin-only: models with user_id set but no auth.users row (should be empty if FK/cascades are healthy). */
export async function detectOrphanedModelRows(userId: string): Promise<OrphanedModelRowsResult> {
  if (!userId?.trim()) {
    return { checked: false, orphanCount: 0, sampleModelIds: [] };
  }

  const admin = await isCurrentUserAdmin();
  if (!admin) {
    return { checked: false, orphanCount: 0, sampleModelIds: [] };
  }

  try {
    const { data, error } = await supabase.rpc('admin_detect_orphaned_model_rows', {
      p_user_id: userId,
    });
    if (error) {
      console.error('detectOrphanedModelRows RPC error:', error);
      return { checked: false, orphanCount: 0, sampleModelIds: [] };
    }
    const row = parseRpcJson(data);
    const orphanCount =
      typeof row?.orphan_count === 'number'
        ? row.orphan_count
        : Number(row?.orphan_count ?? 0) || 0;
    const sampleRaw = row?.sample_model_ids;
    const sampleModelIds: string[] = Array.isArray(sampleRaw)
      ? sampleRaw.filter((x): x is string => typeof x === 'string')
      : [];

    if (orphanCount > 0) {
      console.error('[detectOrphanedModelRows]', { userId, orphanCount, sampleModelIds });
    }

    return { checked: true, orphanCount, sampleModelIds };
  } catch (e) {
    console.error('detectOrphanedModelRows exception:', e);
    return { checked: false, orphanCount: 0, sampleModelIds: [] };
  }
}
