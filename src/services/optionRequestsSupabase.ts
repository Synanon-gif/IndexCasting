import { supabase } from '../../lib/supabase';

const OPTION_REQUEST_SELECT =
  'id, client_id, model_id, agency_id, requested_date, status, project_id, client_name, model_name, proposed_price, agency_counter_price, client_price_status, final_status, request_type, currency, start_time, end_time, model_approval, model_approved_at, model_account_linked, booker_id, organization_id, created_by, agency_assignee_user_id, created_at, updated_at';

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
  organization_id: string | null;
  created_by: string | null;
  agency_assignee_user_id: string | null;
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
    .select(OPTION_REQUEST_SELECT)
    .order('created_at', { ascending: false });
  if (error) { console.error('getOptionRequests error:', error); return []; }
  return (data ?? []) as SupabaseOptionRequest[];
}

export async function getOptionRequestById(id: string): Promise<SupabaseOptionRequest | null> {
  const { data, error } = await supabase
    .from('option_requests')
    .select(OPTION_REQUEST_SELECT)
    .eq('id', id)
    .maybeSingle();
  if (error) { console.error('getOptionRequestById error:', error); return null; }
  return data as SupabaseOptionRequest | null;
}

export async function getOptionRequestsByProject(projectId: string): Promise<SupabaseOptionRequest[]> {
  const { data, error } = await supabase
    .from('option_requests')
    .select(OPTION_REQUEST_SELECT)
    .eq('project_id', projectId)
    .order('created_at', { ascending: false });
  if (error) { console.error('getOptionRequestsByProject error:', error); return []; }
  return (data ?? []) as SupabaseOptionRequest[];
}

/** Sichtbare Option-Requests für die aktuelle Session (RLS: Client-Organisation / Legacy client_id). */
export async function getOptionRequestsForCurrentClient(): Promise<SupabaseOptionRequest[]> {
  try {
    const { data, error } = await supabase
      .from('option_requests')
      .select(OPTION_REQUEST_SELECT)
      .order('created_at', { ascending: false });
    if (error) {
      console.error('getOptionRequestsForCurrentClient error:', error);
      return [];
    }
    return (data ?? []) as SupabaseOptionRequest[];
  } catch (e) {
    console.error('getOptionRequestsForCurrentClient exception:', e);
    return [];
  }
}

/** @deprecated Parameter wird ignoriert; nutzt RLS wie getOptionRequestsForCurrentClient. */
export async function getOptionRequestsForClient(_clientId: string): Promise<SupabaseOptionRequest[]> {
  return getOptionRequestsForCurrentClient();
}

export async function getOptionRequestsForAgency(agencyId: string): Promise<SupabaseOptionRequest[]> {
  try {
    const { data, error } = await supabase
      .from('option_requests')
      .select(OPTION_REQUEST_SELECT)
      .eq('agency_id', agencyId)
      .order('created_at', { ascending: false });
    if (error) {
      console.error('getOptionRequestsForAgency error:', error);
      return [];
    }
    return (data ?? []) as SupabaseOptionRequest[];
  } catch (e) {
    console.error('getOptionRequestsForAgency exception:', e);
    return [];
  }
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
  organization_id?: string | null;
  created_by?: string | null;
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
      organization_id: req.organization_id ?? null,
      created_by: req.created_by ?? null,
    })
    .select(OPTION_REQUEST_SELECT)
    .single();
  if (error) { console.error('insertOptionRequest error:', error); return null; }
  return data as SupabaseOptionRequest;
}

export async function updateOptionRequestStatus(
  id: string,
  status: 'in_negotiation' | 'confirmed' | 'rejected'
): Promise<boolean> {
  const { data, error } = await supabase
    .from('option_requests')
    .update({ status })
    .eq('id', id)
    .select('id')
    .maybeSingle();
  if (error) {
    console.error('updateOptionRequestStatus error:', error);
    return false;
  }
  if (!data?.id) {
    console.warn('updateOptionRequestStatus: no row updated (check id / RLS)', id);
    return false;
  }
  return true;
}

/** Datum/Zeit der Option (Client/Agentur). Trigger sync_option_dates_to_calendars pflegt Kalender + gespiegelte Events. */
export async function updateOptionRequestSchedule(
  id: string,
  fields: { requested_date: string; start_time?: string | null; end_time?: string | null }
): Promise<boolean> {
  try {
    const dateNorm = fields.requested_date.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateNorm)) {
      console.error('updateOptionRequestSchedule: invalid date');
      return false;
    }
    const { error } = await supabase
      .from('option_requests')
      .update({
        requested_date: dateNorm,
        start_time: fields.start_time ?? null,
        end_time: fields.end_time ?? null,
      })
      .eq('id', id);
    if (error) {
      console.error('updateOptionRequestSchedule error:', error);
      return false;
    }
    return true;
  } catch (e) {
    console.error('updateOptionRequestSchedule exception:', e);
    return false;
  }
}

/** Model: nur Datum/Zeit, RPC in DB (migration_calendar_reschedule_sync.sql). */
export async function modelUpdateOptionSchedule(
  optionId: string,
  date: string,
  startTime?: string | null,
  endTime?: string | null
): Promise<boolean> {
  try {
    const d = date.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
    const { error } = await supabase.rpc('model_update_option_schedule', {
      p_option_id: optionId,
      p_date: d,
      p_start: startTime ?? '',
      p_end: endTime ?? '',
    });
    if (error) {
      console.error('modelUpdateOptionSchedule error:', error);
      return false;
    }
    return true;
  } catch (e) {
    console.error('modelUpdateOptionSchedule exception:', e);
    return false;
  }
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
  try {
    const { data: { user } } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from('option_request_messages')
      .insert({ option_request_id: requestId, from_role: fromRole, text })
      .select('id, option_request_id, from_role, text, booker_id, booker_name, created_at')
      .single();
    if (error) {
      console.error('addOptionMessage error:', error);
      return null;
    }
    if (fromRole === 'agency' && user?.id) {
      const { error: claimErr } = await supabase
        .from('option_requests')
        .update({ agency_assignee_user_id: user.id })
        .eq('id', requestId)
        .is('agency_assignee_user_id', null);
      if (claimErr) console.error('addOptionMessage claim assignee error:', claimErr);
    }
    return data as SupabaseOptionMessage;
  } catch (e) {
    console.error('addOptionMessage exception:', e);
    return null;
  }
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
    .select(OPTION_REQUEST_SELECT)
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
