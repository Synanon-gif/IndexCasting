import { supabase } from '../../lib/supabase';

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

/**
 * @deprecated Use getProjectsForOrg(organizationId) for org-scoped access.
 * This function filters by owner_id (a user UUID) which does not enforce org isolation.
 * It is kept for backwards compatibility only. New code must use getProjectsForOrg.
 */
export async function getProjectsForOwner(ownerId: string): Promise<SupabaseProject[]> {
  console.warn(
    '[projectsSupabase] getProjectsForOwner is deprecated and org-unscoped. ' +
    'Migrate callers to getProjectsForOrg(organizationId).',
  );
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
  return (data ?? []).map((d: any) => d.model_id);
}

/**
 * Adds a model to a client project.
 *
 * Delegates to the add_model_to_project SECURITY DEFINER RPC which validates:
 *   1. The project belongs to the caller's client organization.
 *   2. The model's agency has an active connection with the client organization.
 * Prevents clients from adding models from agencies they have no relationship with.
 */
export async function addModelToProject(projectId: string, modelId: string): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc('add_model_to_project', {
      p_project_id: projectId,
      p_model_id:   modelId,
    });
    if (error) {
      console.error('addModelToProject RPC error:', error);
      return false;
    }
    return data === true;
  } catch (e) {
    console.error('addModelToProject exception:', e);
    return false;
  }
}

export async function removeModelFromProject(projectId: string, modelId: string): Promise<boolean> {
  // Service-layer validation: verify the project exists and is accessible to the caller
  // before issuing the DELETE. RLS enforces this at the DB level, but an explicit read
  // here provides a consistent error path and prevents silent no-ops on non-existent rows.
  try {
    const { data: project, error: readError } = await supabase
      .from('client_projects')
      .select('id')
      .eq('id', projectId)
      .maybeSingle();
    if (readError) { console.error('removeModelFromProject project check error:', readError); return false; }
    if (!project) {
      console.error('removeModelFromProject: project not found or not accessible:', projectId);
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
