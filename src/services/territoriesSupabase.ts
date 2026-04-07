import { supabase } from '../../lib/supabase';

/**
 * Model-Territorien (Agentur ↔ Model).
 * READS: ausschließlich aus model_assignments (org-zentrisch).
 * WRITES: über SECURITY DEFINER RPCs (dual-write, Backward-Compat).
 */
export type ModelTerritory = {
  id: string;
  model_id: string;
  agency_id: string;
  country_code: string;
  created_at?: string;
};

// ---------------------------------------------------------------------------
// READ helpers
// ---------------------------------------------------------------------------

/**
 * Fetches all territories for every model belonging to an agency.
 * Returns a map: model_id → sorted country codes[].
 * Uses SECURITY DEFINER RPC (returns r_model_id, r_country_code).
 */
export async function getTerritoriesForAgency(
  agencyId: string,
): Promise<Record<string, string[]>> {
  try {
    const { data, error } = await supabase.rpc('get_territories_for_agency_roster', {
      p_agency_id: agencyId,
    });

    if (error) {
      console.error('getTerritoriesForAgency rpc error:', error);
      // Fallback: org_id via organizations.agency_id, dann model_assignments lesen
      try {
        const { data: orgRow, error: orgErr } = await supabase
          .from('organizations')
          .select('id')
          .eq('agency_id', agencyId)
          .eq('type', 'agency')
          .maybeSingle();
        if (orgErr || !orgRow) { console.error('getTerritoriesForAgency fallback org lookup error:', orgErr); return {}; }
        const { data: fb, error: fbErr } = await supabase
          .from('model_assignments')
          .select('model_id, territory')
          .eq('organization_id', orgRow.id)
          .order('territory');
        if (fbErr) { console.error('getTerritoriesForAgency fallback error:', fbErr); return {}; }
        return buildAgencyMap(fb ?? [], 'model_id', 'territory');
      } catch (fbEx) {
        console.error('getTerritoriesForAgency fallback exception:', fbEx);
        return {};
      }
    }

    // RPC returns rows with r_model_id / r_country_code columns
    return buildAgencyMap(
      (data as Array<{ r_model_id: string; r_country_code: string }>) ?? [],
      'r_model_id',
      'r_country_code',
    );
  } catch (e) {
    console.error('getTerritoriesForAgency exception:', e);
    return {};
  }
}

function buildAgencyMap(
  rows: Array<Record<string, string>>,
  modelIdKey: string,
  countryKey: string,
): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  for (const row of rows) {
    const mid = row[modelIdKey];
    if (!mid) continue;
    if (!map[mid]) map[mid] = [];
    map[mid].push(row[countryKey].toUpperCase());
  }
  return map;
}

/**
 * Fetches territories for a single model, optionally scoped to one agency.
 * Uses SECURITY DEFINER RPC (returns r_id, r_model_id, r_agency_id, r_country_code, r_created_at).
 */
export async function getTerritoriesForModel(
  modelId: string,
  agencyId?: string,
): Promise<ModelTerritory[]> {
  try {
    const { data, error } = await supabase.rpc('get_territories_for_model', {
      p_model_id: modelId,
      p_agency_id: agencyId ?? null,
    });

    if (error) {
      console.error('getTerritoriesForModel rpc error:', error);
      // Fallback: liest aus model_assignments (org-zentrisch, kein model_agency_territories)
      try {
        let orgId: string | null = null;
        if (agencyId) {
          const { data: orgRow } = await supabase
            .from('organizations')
            .select('id')
            .eq('agency_id', agencyId)
            .eq('type', 'agency')
            .maybeSingle();
          orgId = (orgRow as { id: string } | null)?.id ?? null;
        }
        let q = supabase
          .from('model_assignments')
          .select('id, model_id, organization_id, territory, created_at')
          .eq('model_id', modelId)
          .order('territory');
        if (orgId) q = q.eq('organization_id', orgId);
        const { data: fb, error: fbErr } = await q;
        if (fbErr) { console.error('getTerritoriesForModel fallback error:', fbErr); return []; }
        // Map model_assignments shape → ModelTerritory shape (agency_id bleibt leer, da wir org-zentrisch sind)
        return ((fb ?? []) as Array<{ id: string; model_id: string; organization_id: string; territory: string; created_at?: string }>).map((r) => ({
          id: r.id,
          model_id: r.model_id,
          agency_id: agencyId ?? '',
          country_code: r.territory,
          created_at: r.created_at,
        }));
      } catch (fbEx) {
        console.error('getTerritoriesForModel fallback exception:', fbEx);
        return [];
      }
    }

    // Map r_* columns back to ModelTerritory shape
    return ((data as Array<{
      r_id: string; r_model_id: string; r_agency_id: string;
      r_country_code: string; r_created_at?: string;
    }>) ?? []).map((r) => ({
      id: r.r_id,
      model_id: r.r_model_id,
      agency_id: r.r_agency_id,
      country_code: r.r_country_code,
      created_at: r.r_created_at,
    }));
  } catch (e) {
    console.error('getTerritoriesForModel exception:', e);
    return [];
  }
}

// ---------------------------------------------------------------------------
// WRITE helpers — all go through save_model_territories RPC
// ---------------------------------------------------------------------------

/**
 * Replaces all territories for a model+agency with the given list.
 * Uses SECURITY DEFINER RPC save_model_territories (RETURNS BOOLEAN).
 * After the RPC succeeds, re-fetches the saved rows so the caller has fresh data.
 * Throws on any error so callers surface it to the user.
 */
export async function upsertTerritoriesForModel(
  modelId: string,
  agencyId: string,
  countryCodes: string[],
): Promise<ModelTerritory[]> {
  const normalized = Array.from(
    new Set(countryCodes.map((c) => c.trim().toUpperCase()).filter(Boolean)),
  );

  const { data, error } = await supabase.rpc('save_model_territories', {
    p_model_id: modelId,
    p_agency_id: agencyId,
    p_country_codes: normalized,
  });

  if (error) {
    console.error('upsertTerritoriesForModel rpc error:', error);
    throw new Error(`Territory save failed: ${error.message}`);
  }

  if (!data) {
    throw new Error(
      'Territory save failed: no result from server. Please try again or contact support.',
    );
  }

  // Re-fetch saved rows for the caller
  return getTerritoriesForModel(modelId, agencyId);
}

/**
 * Merge territory claims per (country, agency) pair.
 * Groups by agency_id and calls upsertTerritoriesForModel once per agency.
 */
export async function upsertTerritoriesForModelCountryAgencyPairs(
  modelId: string,
  pairs: Array<{ country_code: string; agency_id: string }>,
): Promise<ModelTerritory[]> {
  const normalized = pairs
    .map((p) => ({ country_code: p.country_code.trim().toUpperCase(), agency_id: p.agency_id }))
    .filter((p) => Boolean(p.country_code) && Boolean(p.agency_id));

  // Last agency_id wins per country
  const dedupByCountry = new Map<string, { country_code: string; agency_id: string }>();
  for (const p of normalized) dedupByCountry.set(p.country_code, p);

  if (dedupByCountry.size === 0) return [];

  // Group by agency_id
  const byAgency = new Map<string, string[]>();
  for (const { country_code, agency_id } of dedupByCountry.values()) {
    if (!byAgency.has(agency_id)) byAgency.set(agency_id, []);
    byAgency.get(agency_id)!.push(country_code);
  }

  const results: ModelTerritory[] = [];
  for (const [agId, codes] of byAgency) {
    const rows = await upsertTerritoriesForModel(modelId, agId, codes);
    results.push(...rows);
  }
  return results;
}

/**
 * ADDITIVE territory assignment for a single model.
 * Adds new countries WITHOUT removing existing territories.
 * Uses `add_model_territories` SECURITY DEFINER RPC.
 * Throws on error.
 */
export async function addTerritoriesForModel(
  modelId: string,
  agencyId: string,
  countryCodes: string[],
): Promise<ModelTerritory[]> {
  const normalized = Array.from(
    new Set(countryCodes.map((c) => c.trim().toUpperCase()).filter(Boolean)),
  );
  if (normalized.length === 0) return getTerritoriesForModel(modelId, agencyId);

  const { data, error } = await supabase.rpc('add_model_territories', {
    p_model_id: modelId,
    p_agency_id: agencyId,
    p_country_codes: normalized,
  });

  if (error) {
    console.error('addTerritoriesForModel rpc error:', error);
    throw new Error(`Territory add failed: ${error.message}`);
  }

  if (!data) {
    throw new Error(
      'Territory add failed: no result from server. Please try again or contact support.',
    );
  }

  return getTerritoriesForModel(modelId, agencyId);
}

/**
 * ADDITIVE bulk-assign: adds territories to multiple models without removing existing ones.
 * Used by the bulk selection panel under "My Models".
 *
 * Uses bulk_add_model_territories RPC (migration_add_territories_bulk_rpc.sql)
 * instead of a for-loop → 1 DB round-trip instead of N × 2 (one per model).
 * Falls back to serial per-model if the RPC is not yet deployed.
 */
export async function bulkAddTerritoriesForModels(
  modelIds: string[],
  agencyId: string,
  countryCodes: string[],
): Promise<{ succeededIds: string[]; failedIds: string[] }> {
  if (modelIds.length === 0) return { succeededIds: [], failedIds: [] };

  try {
    const { error } = await supabase.rpc('bulk_add_model_territories', {
      p_model_ids:     modelIds,
      p_agency_id:     agencyId,
      p_country_codes: countryCodes,
    });

    if (!error) {
      return { succeededIds: [...modelIds], failedIds: [] };
    }

    // RPC not yet deployed — fall back to serial per-model calls
    console.warn('bulkAddTerritoriesForModels: bulk RPC unavailable, falling back to serial', error);
  } catch (e) {
    console.warn('bulkAddTerritoriesForModels: bulk RPC threw, falling back to serial', e);
  }

  const succeededIds: string[] = [];
  const failedIds: string[] = [];
  for (const modelId of modelIds) {
    try {
      await addTerritoriesForModel(modelId, agencyId, countryCodes);
      succeededIds.push(modelId);
    } catch (e) {
      console.error('bulkAddTerritoriesForModels serial fallback error for model', modelId, e);
      failedIds.push(modelId);
    }
  }
  return { succeededIds, failedIds };
}

/**
 * REPLACE bulk-assign: replaces territories for multiple models (full replace per model).
 * @deprecated Use bulkAddTerritoriesForModels for bulk panel — it preserves existing territories.
 *
 * Uses bulk_save_model_territories RPC (migration_add_territories_bulk_rpc.sql).
 * Falls back to serial per-model if the RPC is not yet deployed.
 */
export async function bulkUpsertTerritoriesForModels(
  modelIds: string[],
  agencyId: string,
  countryCodes: string[],
): Promise<{ succeededIds: string[]; failedIds: string[] }> {
  if (modelIds.length === 0) return { succeededIds: [], failedIds: [] };

  try {
    const { error } = await supabase.rpc('bulk_save_model_territories', {
      p_model_ids:     modelIds,
      p_agency_id:     agencyId,
      p_country_codes: countryCodes,
    });

    if (!error) {
      return { succeededIds: [...modelIds], failedIds: [] };
    }

    console.warn('bulkUpsertTerritoriesForModels: bulk RPC unavailable, falling back to serial', error);
  } catch (e) {
    console.warn('bulkUpsertTerritoriesForModels: bulk RPC threw, falling back to serial', e);
  }

  const succeededIds: string[] = [];
  const failedIds: string[] = [];
  for (const modelId of modelIds) {
    try {
      await upsertTerritoriesForModel(modelId, agencyId, countryCodes);
      succeededIds.push(modelId);
    } catch (e) {
      console.error('bulkUpsertTerritoriesForModels serial fallback error for model', modelId, e);
      failedIds.push(modelId);
    }
  }
  return { succeededIds, failedIds };
}

/**
 * Booking routing helper: returns the agency_id responsible for a model in a country.
 * @deprecated Nutze resolveOrganizationForModelAndCountry für den org-zentrischen Pfad.
 * Intern: liest jetzt ausschließlich aus model_assignments (via organizations.agency_id).
 */
export async function resolveAgencyForModelAndCountry(
  modelId: string,
  countryCode: string,
): Promise<string | null> {
  const code = countryCode.trim().toUpperCase();
  if (!code) return null;

  try {
    const orgId = await resolveOrganizationForModelAndCountry(modelId, code);
    if (!orgId) return null;

    const { data, error } = await supabase
      .from('organizations')
      .select('agency_id')
      .eq('id', orgId)
      .maybeSingle();

    if (error) { console.error('resolveAgencyForModelAndCountry org lookup error:', error); return null; }
    return (data as { agency_id: string | null } | null)?.agency_id ?? null;
  } catch (e) {
    console.error('resolveAgencyForModelAndCountry exception:', e);
    return null;
  }
}

/**
 * Org-zentrische Variante: liefert die organization_id der Agentur, die das Model
 * im angegebenen Land vertritt (via model_assignments).
 */
export async function resolveOrganizationForModelAndCountry(
  modelId: string,
  countryCode: string,
): Promise<string | null> {
  const code = countryCode.trim().toUpperCase();
  if (!code) return null;

  try {
    const { data, error } = await supabase
      .from('model_assignments')
      .select('organization_id')
      .eq('model_id', modelId)
      .eq('territory', code)
      .maybeSingle();

    if (error) { console.error('resolveOrganizationForModelAndCountry error:', error); return null; }
    return (data as { organization_id: string } | null)?.organization_id ?? null;
  } catch (e) {
    console.error('resolveOrganizationForModelAndCountry exception:', e);
    return null;
  }
}

/**
 * Fetches all model_assignments for a given organization (org-zentrisch).
 * Returns a map: model_id → sorted territory codes[].
 * Uses SECURITY DEFINER RPC get_assignments_for_agency_roster.
 */
export async function getAssignmentsForAgency(
  organizationId: string,
): Promise<Record<string, string[]>> {
  try {
    const { data, error } = await supabase.rpc('get_assignments_for_agency_roster', {
      p_organization_id: organizationId,
    });

    if (error) {
      console.error('getAssignmentsForAgency rpc error:', error);
      return {};
    }

    const map: Record<string, string[]> = {};
    for (const row of (data as Array<{ r_model_id: string; r_territory: string }> ?? [])) {
      if (!row.r_model_id) continue;
      if (!map[row.r_model_id]) map[row.r_model_id] = [];
      map[row.r_model_id].push(row.r_territory.toUpperCase());
    }
    return map;
  } catch (e) {
    console.error('getAssignmentsForAgency exception:', e);
    return {};
  }
}

export type ModelAssignment = {
  id: string;
  model_id: string;
  organization_id: string;
  territory: string;
  role: 'mother' | 'exclusive' | 'non_exclusive';
  created_at?: string;
};

/**
 * Fetches assignments for a single model, optionally scoped to one organization.
 * Uses SECURITY DEFINER RPC get_assignments_for_model.
 */
export async function getAssignmentsForModel(
  modelId: string,
  organizationId?: string,
): Promise<ModelAssignment[]> {
  try {
    const { data, error } = await supabase.rpc('get_assignments_for_model', {
      p_model_id: modelId,
      p_organization_id: organizationId ?? null,
    });

    if (error) {
      console.error('getAssignmentsForModel rpc error:', error);
      return [];
    }

    return ((data as Array<{
      r_id: string; r_model_id: string; r_organization_id: string;
      r_territory: string; r_role: string; r_created_at?: string;
    }>) ?? []).map((r) => ({
      id: r.r_id,
      model_id: r.r_model_id,
      organization_id: r.r_organization_id,
      territory: r.r_territory,
      role: r.r_role as ModelAssignment['role'],
      created_at: r.r_created_at,
    }));
  } catch (e) {
    console.error('getAssignmentsForModel exception:', e);
    return [];
  }
}

/**
 * Replaces all assignments for (model, organization) with the given country codes.
 * Org-zentrisch: nutzt save_model_assignments RPC.
 * Dual-Write: schreibt auch in model_agency_territories für Backward-Compat.
 */
export async function upsertAssignmentsForModel(
  modelId: string,
  organizationId: string,
  countryCodes: string[],
  role: 'mother' | 'exclusive' | 'non_exclusive' = 'non_exclusive',
): Promise<ModelAssignment[]> {
  const normalized = Array.from(
    new Set(countryCodes.map((c) => c.trim().toUpperCase()).filter(Boolean)),
  );

  const { data, error } = await supabase.rpc('save_model_assignments', {
    p_model_id: modelId,
    p_organization_id: organizationId,
    p_country_codes: normalized,
    p_role: role,
  });

  if (error) {
    console.error('upsertAssignmentsForModel rpc error:', error);
    throw new Error(`Assignment save failed: ${error.message}`);
  }

  if (!data) {
    throw new Error(
      'Assignment save failed: no result from server. Please try again or contact support.',
    );
  }

  return getAssignmentsForModel(modelId, organizationId);
}
