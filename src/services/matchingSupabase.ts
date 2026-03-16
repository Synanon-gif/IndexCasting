/**
 * KI-Matching, Daily Boost, Gamification Services.
 * pgvector-basierte Similarity-Search für Model-Matching.
 */
import { supabase } from '../../lib/supabase';

// ---- KI-Matching ----

export async function findSimilarModels(
  queryEmbedding: number[],
  threshold = 0.7,
  count = 10
): Promise<Array<{ model_id: string; similarity: number }>> {
  const { data, error } = await supabase.rpc('match_models', {
    query_embedding: queryEmbedding,
    match_threshold: threshold,
    match_count: count,
  });
  if (error) { console.error('findSimilarModels error:', error); return []; }
  return (data ?? []) as Array<{ model_id: string; similarity: number }>;
}

export async function upsertModelEmbedding(modelId: string, embedding: number[]): Promise<boolean> {
  const { error } = await supabase
    .from('model_embeddings')
    .upsert({ model_id: modelId, embedding, updated_at: new Date().toISOString() });
  if (error) { console.error('upsertModelEmbedding error:', error); return false; }
  return true;
}

export async function upsertClientPreference(userId: string, embedding: number[]): Promise<boolean> {
  const { error } = await supabase
    .from('client_preference_embeddings')
    .upsert({ user_id: userId, embedding, updated_at: new Date().toISOString() });
  if (error) { console.error('upsertClientPreference error:', error); return false; }
  return true;
}

// ---- Daily Boost ----

export async function boostModel(modelId: string): Promise<boolean> {
  const { error } = await supabase
    .from('boosts')
    .insert({ model_id: modelId });
  if (error) {
    if (error.code === '23505') return false; // Already boosted today
    console.error('boostModel error:', error);
    return false;
  }
  return true;
}

export async function hasModelBoostedToday(modelId: string): Promise<boolean> {
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await supabase
    .from('boosts')
    .select('id')
    .eq('model_id', modelId)
    .eq('boosted_at', today)
    .maybeSingle();
  return !!data;
}

export async function getBoostedModelIds(): Promise<string[]> {
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from('boosts')
    .select('model_id')
    .eq('boosted_at', today);
  if (error) return [];
  return (data ?? []).map((d: any) => d.model_id);
}

// ---- Gamification: Badges ----

export type Badge = {
  id: string;
  user_id: string;
  badge_type: string;
  earned_at: string;
};

export async function getUserBadges(userId: string): Promise<Badge[]> {
  const { data, error } = await supabase
    .from('badges')
    .select('*')
    .eq('user_id', userId)
    .order('earned_at', { ascending: false });
  if (error) return [];
  return (data ?? []) as Badge[];
}

export async function awardBadge(userId: string, badgeType: string): Promise<boolean> {
  const { data: existing } = await supabase
    .from('badges')
    .select('id')
    .eq('user_id', userId)
    .eq('badge_type', badgeType)
    .maybeSingle();
  if (existing) return false; // Already has badge

  const { error } = await supabase
    .from('badges')
    .insert({ user_id: userId, badge_type: badgeType });
  if (error) { console.error('awardBadge error:', error); return false; }
  return true;
}

// ---- Gamification: Streaks ----

export type Streak = {
  user_id: string;
  current_streak: number;
  longest_streak: number;
  last_active_date: string;
};

export async function getStreak(userId: string): Promise<Streak | null> {
  const { data, error } = await supabase
    .from('streaks')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) return null;
  return data as Streak | null;
}

export async function updateStreak(userId: string): Promise<Streak | null> {
  const today = new Date().toISOString().slice(0, 10);
  const existing = await getStreak(userId);

  if (!existing) {
    const { data, error } = await supabase
      .from('streaks')
      .insert({ user_id: userId, current_streak: 1, longest_streak: 1, last_active_date: today })
      .select()
      .single();
    if (error) return null;
    return data as Streak;
  }

  if (existing.last_active_date === today) return existing;

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().slice(0, 10);

  const newStreak = existing.last_active_date === yesterdayStr
    ? existing.current_streak + 1
    : 1;
  const newLongest = Math.max(existing.longest_streak, newStreak);

  const { data, error } = await supabase
    .from('streaks')
    .update({
      current_streak: newStreak,
      longest_streak: newLongest,
      last_active_date: today,
    })
    .eq('user_id', userId)
    .select()
    .single();
  if (error) return null;
  return data as Streak;
}
