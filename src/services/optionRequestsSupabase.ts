import { supabase } from '../../lib/supabase';

/**
 * Option Requests + Chat (Kunde ↔ Agentur).
 * Alle Anfragen, Nachrichten und Anhänge in Supabase:
 * - option_requests (client_id, agency_id, model_id) – pro Partei abrufbar
 * - option_request_messages – pro option_request_id
 * - option_documents + Storage (chat-files/options/…) – pro option_request_id, uploaded_by
 */
export type SupabaseOptionRequest = {
  id: string;
  client_id: string;
  model_id: string;
  agency_id: string;
  requested_date: string;
  status: 'in_negotiation' | 'confirmed' | 'rejected';
  project_id: string | null;
  client_name: string | null;
  model_name: string | null;
  proposed_price: number | null;
  agency_counter_price: number | null;
  client_price_status: 'pending' | 'accepted' | 'rejected' | null;
  final_status: 'option_pending' | 'option_confirmed' | 'job_confirmed' | null;
  request_type: 'option' | 'casting' | null;
  currency: string | null;
  start_time: string | null;
  end_time: string | null;
  model_approval: 'pending' | 'approved' | 'rejected';
  model_approved_at: string | null;
  /** false = no models.user_id; negotiation proceeds client↔agency only */
  model_account_linked?: boolean | null;
  booker_id: string | null;
  created_at: string;
  updated_at: string;
};

export type SupabaseOptionMessage = {
  id: string;
  option_request_id: string;
  from_role: 'client' | 'agency';
  text: string;
  // optional, for future system / typed messages
  message_type?: 'user' | 'system';
  booker_id: string | null;
  booker_name: string | null;
  created_at: string;
};

export type SupabaseOptionDocument = {
  id: string;
  option_request_id: string;
  uploaded_by: string;
  file_name: string;
  file_url: string;
  file_type: string | null;
  created_at: string;
};

export async function getOptionRequests(): Promise<SupabaseOptionRequest[]> {
  const { data, error } = await supabase
    .from('option_requests')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) { console.error('getOptionRequests error:', error); return []; }
  return (data ?? []) as SupabaseOptionRequest[];
}

export async function getOptionRequestById(id: string): Promise<SupabaseOptionRequest | null> {
  const { data, error } = await supabase
    .from('option_requests')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) { console.error('getOptionRequestById error:', error); return null; }
  return data as SupabaseOptionRequest | null;
}

export async function getOptionRequestsByProject(projectId: string): Promise<SupabaseOptionRequest[]> {
  const { data, error } = await supabase
    .from('option_requests')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false });
  if (error) { console.error('getOptionRequestsByProject error:', error); return []; }
  return (data ?? []) as SupabaseOptionRequest[];
}

export async function getOptionRequestsForClient(clientId: string): Promise<SupabaseOptionRequest[]> {
  const { data, error } = await supabase
    .from('option_requests')
    .select('*')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false });
  if (error) { console.error('getOptionRequestsForClient error:', error); return []; }
  return (data ?? []) as SupabaseOptionRequest[];
}

export async function getOptionRequestsForAgency(agencyId: string): Promise<SupabaseOptionRequest[]> {
  const { data, error } = await supabase
    .from('option_requests')
    .select('*')
    .eq('agency_id', agencyId)
    .order('created_at', { ascending: false });
  if (error) { console.error('getOptionRequestsForAgency error:', error); return []; }
  return (data ?? []) as SupabaseOptionRequest[];
}

export async function insertOptionRequest(req: {
  client_id: string;
  model_id: string;
  agency_id: string;
  requested_date: string;
  request_type?: 'option' | 'casting';
  project_id?: string;
  client_name?: string;
  model_name?: string;
  proposed_price?: number;
  currency?: string;
  start_time?: string;
  end_time?: string;
}): Promise<SupabaseOptionRequest | null> {
  const { data: modelRow } = await supabase
    .from('models')
    .select('user_id')
    .eq('id', req.model_id)
    .maybeSingle();
  const modelAccountLinked = !!(modelRow as { user_id?: string | null } | null)?.user_id;
  const modelApproval = modelAccountLinked ? 'pending' : 'approved';
  const modelApprovedAt = modelAccountLinked ? null : new Date().toISOString();

  const { data, error } = await supabase
    .from('option_requests')
    .insert({
      client_id: req.client_id,
      model_id: req.model_id,
      agency_id: req.agency_id,
      requested_date: req.requested_date,
      project_id: req.project_id || null,
      client_name: req.client_name || null,
      model_name: req.model_name || null,
      proposed_price: req.proposed_price || null,
      agency_counter_price: null,
      client_price_status: 'pending',
      final_status: 'option_pending',
      request_type: req.request_type || 'option',
      currency: req.currency || null,
      start_time: req.start_time || null,
      end_time: req.end_time || null,
      status: 'in_negotiation',
      model_approval: modelApproval,
      model_approved_at: modelApprovedAt,
      model_account_linked: modelAccountLinked,
    })
    .select()
    .single();
  if (error) { console.error('insertOptionRequest error:', error); return null; }
  return data as SupabaseOptionRequest;
}

export async function updateOptionRequestStatus(
  id: string,
  status: 'in_negotiation' | 'confirmed' | 'rejected'
): Promise<boolean> {
  const { error } = await supabase
    .from('option_requests')
    .update({ status })
    .eq('id', id);
  if (error) { console.error('updateOptionRequestStatus error:', error); return false; }
  return true;
}

export async function setAgencyCounterOffer(
  id: string,
  counterPrice: number
): Promise<boolean> {
  const { error } = await supabase
    .from('option_requests')
    .update({
      agency_counter_price: counterPrice,
      client_price_status: 'pending',
      final_status: 'option_pending',
    })
    .eq('id', id);
  if (error) { console.error('setAgencyCounterOffer error:', error); return false; }
  return true;
}

export async function agencyAcceptClientPrice(id: string): Promise<boolean> {
  const { error } = await supabase
    .from('option_requests')
    .update({
      client_price_status: 'accepted',
      final_status: 'option_confirmed',
    })
    .eq('id', id);
  if (error) { console.error('agencyAcceptClientPrice error:', error); return false; }
  return true;
}

/** Agency declines the client's proposed fee; counter-offer UI becomes the next step. */
export async function agencyRejectClientPrice(id: string): Promise<boolean> {
  const { error } = await supabase
    .from('option_requests')
    .update({ client_price_status: 'rejected' })
    .eq('id', id);
  if (error) { console.error('agencyRejectClientPrice error:', error); return false; }
  return true;
}

export async function clientAcceptCounterPrice(id: string): Promise<boolean> {
  const { error } = await supabase
    .from('option_requests')
    .update({
      client_price_status: 'accepted',
      final_status: 'option_confirmed',
    })
    .eq('id', id);
  if (error) { console.error('clientAcceptCounterPrice error:', error); return false; }
  return true;
}

export async function clientConfirmJobOnSupabase(id: string): Promise<boolean> {
  const { error } = await supabase
    .from('option_requests')
    .update({
      final_status: 'job_confirmed',
      status: 'confirmed',
    })
    .eq('id', id);
  if (error) { console.error('clientConfirmJobOnSupabase error:', error); return false; }
  return true;
}

export async function getOptionMessages(requestId: string): Promise<SupabaseOptionMessage[]> {
  const { data, error } = await supabase
    .from('option_request_messages')
    .select('*')
    .eq('option_request_id', requestId)
    .order('created_at', { ascending: true });
  if (error) { console.error('getOptionMessages error:', error); return []; }
  return (data ?? []) as SupabaseOptionMessage[];
}

export async function addOptionMessage(
  requestId: string,
  fromRole: 'client' | 'agency',
  text: string
): Promise<SupabaseOptionMessage | null> {
  const { data, error } = await supabase
    .from('option_request_messages')
    .insert({ option_request_id: requestId, from_role: fromRole, text })
    .select()
    .single();
  if (error) { console.error('addOptionMessage error:', error); return null; }
  return data as SupabaseOptionMessage;
}

export async function updateModelApproval(
  id: string,
  approval: 'approved' | 'rejected'
): Promise<boolean> {
  const { error } = await supabase
    .from('option_requests')
    .update({
      model_approval: approval,
      model_approved_at: approval === 'approved' ? new Date().toISOString() : null,
    })
    .eq('id', id);
  if (error) { console.error('updateModelApproval error:', error); return false; }
  return true;
}

export async function getOptionRequestsForModel(modelId: string): Promise<SupabaseOptionRequest[]> {
  const { data, error } = await supabase
    .from('option_requests')
    .select('*')
    .eq('model_id', modelId)
    .order('created_at', { ascending: false });
  if (error) { console.error('getOptionRequestsForModel error:', error); return []; }
  return (data ?? []) as SupabaseOptionRequest[];
}

export async function getOptionDocuments(requestId: string): Promise<SupabaseOptionDocument[]> {
  const { data, error } = await supabase
    .from('option_documents')
    .select('*')
    .eq('option_request_id', requestId)
    .order('created_at', { ascending: true });
  if (error) { console.error('getOptionDocuments error:', error); return []; }
  return (data ?? []) as SupabaseOptionDocument[];
}

export async function uploadOptionDocument(
  requestId: string,
  uploadedBy: string,
  file: File | Blob,
  fileName: string
): Promise<SupabaseOptionDocument | null> {
  const path = `options/${requestId}/${Date.now()}_${fileName}`;
  const { error: uploadError } = await supabase.storage
    .from('chat-files')
    .upload(path, file);
  if (uploadError) { console.error('uploadOptionDocument storage error:', uploadError); return null; }
  const { data: urlData } = supabase.storage.from('chat-files').getPublicUrl(path);

  const { data, error } = await supabase
    .from('option_documents')
    .insert({
      option_request_id: requestId,
      uploaded_by: uploadedBy,
      file_name: fileName,
      file_url: urlData.publicUrl,
      file_type: fileName.split('.').pop() || null,
    })
    .select()
    .single();
  if (error) { console.error('uploadOptionDocument error:', error); return null; }
  return data as SupabaseOptionDocument;
}

export async function sendAgencyInvitation(agencyName: string, email: string, invitedBy?: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('agency_invitations')
    .insert({
      agency_name: agencyName,
      email,
      invited_by: invitedBy || null,
    })
    .select('token')
    .single();
  if (error) { console.error('sendAgencyInvitation error:', error); return null; }
  return data?.token ?? null;
}

export function subscribeToOptionMessages(
  requestId: string,
  onMessage: (msg: SupabaseOptionMessage) => void
) {
  const channel = supabase
    .channel(`option-${requestId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'option_request_messages',
        filter: `option_request_id=eq.${requestId}`,
      },
      (payload) => {
        onMessage(payload.new as SupabaseOptionMessage);
      }
    )
    .subscribe();

  return () => { supabase.removeChannel(channel); };
}
