import { supabase } from '../../lib/supabase';
import { uiCopy } from '../constants/uiCopy';
import { fetchEffectiveDisplayCitiesForModels } from './modelLocationsSupabase';
import { getFirstClientVisiblePortfolioUrlForModels } from './modelPhotosSupabase';
import { getModelsByIdsForClientFromSupabase } from './modelsSupabase';
import {
  mapSupabaseModelToClientProjectSummary,
  type ClientProjectModelSummary,
} from '../utils/clientProjectHydration';

/**
 * Kunden-Projekte und zugeordnete Models – in Supabase, pro Kunde (owner_id).
 * client_projects, client_project_models; alle Daten pro Partei gespeichert.
 */
export type SupabaseProject = {
  id: string;
  owner_id: string;
  organization_id: string | null;
  name: string;
  created_at: string;
  updated_at: string;
};

export type SupabaseProjectModel = {
  project_id: string;
  model_id: string;
  added_at: string;
};

/**
 * Fetches all projects visible to the current user.
 * RLS enforces that only the owner or org members can see these projects.
 * Pass organizationId to filter by org; omit for a full list.
 */
export async function getProjectsForOrg(organizationId: string): Promise<SupabaseProject[]> {
  try {
    const { data, error } = await supabase
      .from('client_projects')
      .select('*')
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: false });
    if (error) { console.error('getProjectsForOrg error:', error); return []; }
    return (data ?? []) as SupabaseProject[];
  } catch (e) {
    console.error('getProjectsForOrg exception:', e);
    return [];
  }
}

/** @deprecated Use getProjectsForOrg(organizationId) for org-aware access. */
export async function getProjectsForOwner(ownerId: string): Promise<SupabaseProject[]> {
  try {
    const { data, error } = await supabase
      .from('client_projects')
      .select('*')
      .eq('owner_id', ownerId)
      .order('created_at', { ascending: false });
    if (error) { console.error('getProjectsForOwner error:', error); return []; }
    return (data ?? []) as SupabaseProject[];
  } catch (e) {
    console.error('getProjectsForOwner exception:', e);
    return [];
  }
}

/**
 * Creates a project, linking it to the given organization for org-wide access.
 * Provide organizationId for all new projects — legacy callers without an org
 * can omit it (falls back to personal owner_id scope).
 */
export async function createProject(
  ownerId: string,
  name: string,
  organizationId?: string | null,
): Promise<SupabaseProject | null> {
  try {
    const { data, error } = await supabase
      .from('client_projects')
      .insert({
        owner_id: ownerId,
        name,
        ...(organizationId ? { organization_id: organizationId } : {}),
      })
      .select()
      .single();
    if (error) { console.error('createProject error:', error); return null; }
    return data as SupabaseProject;
  } catch (e) {
    console.error('createProject exception:', e);
    return null;
  }
}

export async function updateProject(projectId: string, name: string): Promise<boolean> {
  const { error } = await supabase
    .from('client_projects')
    .update({ name })
    .eq('id', projectId);
  if (error) { console.error('updateProject error:', error); return false; }
  return true;
}

export async function deleteProject(projectId: string): Promise<boolean> {
  const { error } = await supabase
    .from('client_projects')
    .delete()
    .eq('id', projectId);
  if (error) { console.error('deleteProject error:', error); return false; }
  return true;
}

export async function getProjectModels(projectId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('client_project_models')
    .select('model_id')
    .eq('project_id', projectId);
  if (error) { console.error('getProjectModels error:', error); return []; }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((d: any) => d.model_id);
}

export type HydratedClientProject = {
  id: string;
  name: string;
  owner_id: string;
  models: ClientProjectModelSummary[];
};

/**
 * Org-scoped project list with models loaded from `client_project_models` + client-safe model rows.
 * Source of truth for authenticated client web after sync (not localStorage).
 * When `models.portfolio_images` is empty but `model_photos` has client-visible portfolio rows,
 * cover URLs are filled via the same batch fallback as discovery/detail (§27.1 parity).
 */
export async function fetchHydratedClientProjectsForOrg(
  organizationId: string,
): Promise<HydratedClientProject[]> {
  if (!organizationId?.trim()) return [];
  try {
    const remote = await getProjectsForOrg(organizationId);
    const projectModelIds = await Promise.all(remote.map((rp) => getProjectModels(rp.id)));
    const allIds = [...new Set(projectModelIds.flat())];
    const cityByModel = await fetchEffectiveDisplayCitiesForModels(allIds);
    const modelById = await getModelsByIdsForClientFromSupabase(allIds);
    const mirrorEmptyIds = allIds.filter((id) => {
      const row = modelById.get(id);
      return row != null && !(row.portfolio_images?.length);
    });
    let coverByModelId = new Map<string, string>();
    if (mirrorEmptyIds.length) {
      try {
        coverByModelId = await getFirstClientVisiblePortfolioUrlForModels(mirrorEmptyIds);
      } catch (e) {
        console.error('fetchHydratedClientProjectsForOrg: portfolio cover fallback failed', e);
      }
    }
    return remote.map((rp, i) => {
      const ids = projectModelIds[i];
      const models = ids
        .map((id) => {
          const row = modelById.get(id);
          if (!row) return null;
          const url = coverByModelId.get(id);
          const withCover =
            url && !(row.portfolio_images?.length)
              ? { ...row, portfolio_images: [url] }
              : row;
          return mapSupabaseModelToClientProjectSummary(withCover, {
            effectiveDisplayCity: cityByModel.get(row.id) ?? null,
          });
        })
        .filter((m): m is ReturnType<typeof mapSupabaseModelToClientProjectSummary> => m != null);
      return {
        id: rp.id,
        name: rp.name,
        owner_id: rp.owner_id,
        models,
      };
    });
  } catch (e) {
    console.error('fetchHydratedClientProjectsForOrg exception:', e);
    return [];
  }
}

export type AddModelToProjectResult =
  | { ok: true }
  | { ok: false; userMessage: string };

function mapAddModelToProjectErrorMessage(raw: string | undefined): string {
  const m = (raw ?? '').toLowerCase();
  if (m.includes('no active connection')) return uiCopy.projects.addToProjectNoConnection;
  if (m.includes('project does not belong')) return uiCopy.projects.addToProjectWrongOrg;
  if (m.includes('not a member of the specified client organization')) {
    return uiCopy.projects.addToProjectNotOrgMember;
  }
  if (m.includes('caller has no client organization')) return uiCopy.projects.addToProjectNoClientOrg;
  if (m.includes('model has no agency') || m.includes('does not exist')) {
    return uiCopy.projects.addToProjectModelNoAgency;
  }
  return uiCopy.projects.addToProjectGeneric;
}

/**
 * Adds a model to a client project.
 *
 * Delegates to the add_model_to_project SECURITY DEFINER RPC which validates:
 *   1. The project belongs to the caller's client organization.
 *   2. The model's agency has an active connection with the client organization.
 * Prevents clients from adding models from agencies they have no relationship with.
 *
 * Pass organizationId (client org UUID) when known — multi-org-safe explicit org pin.
 * Pass countryIso (same ISO as discovery filters) so the RPC checks the territory agency
 * (model_agency_territories), aligned with get_discovery_models.
 */
export async function addModelToProject(
  projectId: string,
  modelId: string,
  organizationId?: string | null,
  countryIso?: string | null,
): Promise<AddModelToProjectResult> {
  try {
    const args: {
      p_project_id: string;
      p_model_id: string;
      p_organization_id?: string;
      p_country_iso?: string;
    } = {
      p_project_id: projectId,
      p_model_id: modelId,
    };
    const org = organizationId?.trim();
    if (org) args.p_organization_id = org;
    const iso = countryIso?.trim();
    if (iso) args.p_country_iso = iso.toUpperCase();

    const { data, error } = await supabase.rpc('add_model_to_project', args);
    if (error) {
      console.error('addModelToProject RPC error:', error);
      return { ok: false, userMessage: mapAddModelToProjectErrorMessage(error.message) };
    }
    return data === true ? { ok: true } : { ok: false, userMessage: uiCopy.projects.addToProjectGeneric };
  } catch (e) {
    console.error('addModelToProject exception:', e);
    return { ok: false, userMessage: uiCopy.projects.addToProjectGeneric };
  }
}

export async function removeModelFromProject(projectId: string, modelId: string): Promise<boolean> {
  try {
    // Org-Validierung: aktueller User muss zur selben Org gehören wie das Projekt
    const { data: project, error: projectError } = await supabase
      .from('client_projects')
      .select('organization_id')
      .eq('id', projectId)
      .single();

    if (projectError || !project) {
      console.error('removeModelFromProject: project not found', projectError);
      return false;
    }

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      console.error('removeModelFromProject: not authenticated');
      return false;
    }

    // H-3 Security Audit 2026-04-05: .single() schlug bei Multi-Org-Usern fehl
    // (PGRST116). Gezielte Filterung auf project.organization_id mit .maybeSingle().
    const { data: membership, error: memberError } = await supabase
      .from('organization_members')
      .select('organization_id')
      .eq('user_id', user.id)
      .eq('organization_id', project.organization_id)
      .maybeSingle();

    if (memberError || !membership) {
      console.error('removeModelFromProject: unauthorized — not a member of project org', memberError);
      return false;
    }

    const { error } = await supabase
      .from('client_project_models')
      .delete()
      .eq('project_id', projectId)
      .eq('model_id', modelId);
    if (error) { console.error('removeModelFromProject error:', error); return false; }
    return true;
  } catch (e) {
    console.error('removeModelFromProject exception:', e);
    return false;
  }
}
