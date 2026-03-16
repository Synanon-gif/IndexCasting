import { supabase } from '../../lib/supabase';

/**
 * Kunden-Projekte und zugeordnete Models – in Supabase, pro Kunde (owner_id).
 * client_projects, client_project_models; alle Daten pro Partei gespeichert.
 */
export type SupabaseProject = {
  id: string;
  owner_id: string;
  name: string;
  created_at: string;
  updated_at: string;
};

export type SupabaseProjectModel = {
  project_id: string;
  model_id: string;
  added_at: string;
};

export async function getProjectsForOwner(ownerId: string): Promise<SupabaseProject[]> {
  const { data, error } = await supabase
    .from('client_projects')
    .select('*')
    .eq('owner_id', ownerId)
    .order('created_at', { ascending: false });
  if (error) { console.error('getProjectsForOwner error:', error); return []; }
  return (data ?? []) as SupabaseProject[];
}

export async function createProject(ownerId: string, name: string): Promise<SupabaseProject | null> {
  const { data, error } = await supabase
    .from('client_projects')
    .insert({ owner_id: ownerId, name })
    .select()
    .single();
  if (error) { console.error('createProject error:', error); return null; }
  return data as SupabaseProject;
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

export async function addModelToProject(projectId: string, modelId: string): Promise<boolean> {
  const { error } = await supabase
    .from('client_project_models')
    .insert({ project_id: projectId, model_id: modelId });
  if (error) {
    if (error.code === '23505') return true; // Already exists
    console.error('addModelToProject error:', error);
    return false;
  }
  return true;
}

export async function removeModelFromProject(projectId: string, modelId: string): Promise<boolean> {
  const { error } = await supabase
    .from('client_project_models')
    .delete()
    .eq('project_id', projectId)
    .eq('model_id', modelId);
  if (error) { console.error('removeModelFromProject error:', error); return false; }
  return true;
}
