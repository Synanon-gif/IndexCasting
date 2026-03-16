import { supabase } from '../../lib/supabase';

export type Stipp = {
  id: string;
  from_user_id: string;
  to_model_id: string;
  created_at: string;
};

export type ModelTraction = {
  model_id: string;
  name: string;
  agency_id: string;
  stippen_count: number;
};

export async function stippModel(userId: string, modelId: string): Promise<boolean> {
  const { error } = await supabase
    .from('stippen')
    .insert({ from_user_id: userId, to_model_id: modelId });
  if (error) {
    if (error.code === '23505') return true; // Already stippt
    console.error('stippModel error:', error);
    return false;
  }
  return true;
}

export async function unstippModel(userId: string, modelId: string): Promise<boolean> {
  const { error } = await supabase
    .from('stippen')
    .delete()
    .eq('from_user_id', userId)
    .eq('to_model_id', modelId);
  if (error) { console.error('unstippModel error:', error); return false; }
  return true;
}

export async function getUserStipps(userId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('stippen')
    .select('to_model_id')
    .eq('from_user_id', userId);
  if (error) { console.error('getUserStipps error:', error); return []; }
  return (data ?? []).map((d: any) => d.to_model_id);
}

export async function getModelTraction(): Promise<ModelTraction[]> {
  const { data, error } = await supabase
    .from('model_traction')
    .select('*')
    .order('stippen_count', { ascending: false });
  if (error) { console.error('getModelTraction error:', error); return []; }
  return (data ?? []) as ModelTraction[];
}

export async function getModelTractionById(modelId: string): Promise<number> {
  const { data, error } = await supabase
    .from('model_traction')
    .select('stippen_count')
    .eq('model_id', modelId)
    .maybeSingle();
  if (error) { console.error('getModelTractionById error:', error); return 0; }
  return data?.stippen_count ?? 0;
}
