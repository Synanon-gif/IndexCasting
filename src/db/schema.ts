/**
 * Data schema for backend (Supabase-compatible).
 * Tables: users, models, projects, conversations, messages.
 * RLS: Data access is filtered by authorized user IDs.
 */

export type UserRole = 'model' | 'agent' | 'client';

export type User = {
  id: string;
  email: string;
  display_name: string;
  role: UserRole;
  created_at: number;
  updated_at: number;
};

export type Model = {
  id: string;
  /** Sync-ID for Mediaslide (external system). Replace with Mediaslide ID when connected. */
  mediaslide_sync_id: string | null;
  user_id: string;
  name: string;
  height: number;
  bust: number;
  waist: number;
  hips: number;
  city: string;
  hair_color: string;
  portfolio_images: string[];
  polaroids: string[];
  is_visible_commercial: boolean;
  is_visible_fashion: boolean;
  /** Sports dimension — independent of Fashion/Commercial categories. */
  is_sports_winter: boolean;
  is_sports_summer: boolean;
  /** Biological sex: 'male' | 'female' | null (not yet specified). */
  sex: 'male' | 'female' | null;
  created_at: number;
  updated_at: number;
};

export type Project = {
  id: string;
  owner_id: string;
  name: string;
  model_ids: string[];
  created_at: number;
  updated_at: number;
};

export type ConversationContextType = 'option' | 'booking';

/** Context for option negotiations (Client <-> Agency) or booking (Agency <-> Model). */
export type Conversation = {
  id: string;
  type: ConversationContextType;
  /** For 'option': project_id or option_request_id. For 'booking': application_id or booking_id. */
  context_id: string;
  context_label: string;
  participant_ids: string[];
  created_at: number;
  updated_at: number;
};

export type Message = {
  id: string;
  conversation_id: string;
  sender_id: string;
  receiver_id: string;
  text: string;
  created_at: number;
};
