import { supabase } from '../../lib/supabase';

/**
 * Booker (Kunde + Agentur) – in Supabase, pro Partei: client_id oder agency_id.
 * bookers-Tabelle; alle Daten und bookings_completed persistent.
 */
export type Booker = {
  id: string;
  user_id: string | null;
  agency_id: string | null;
  client_id: string | null;
  display_name: string;
  email: string | null;
  bookings_completed: number;
  is_master: boolean;
  created_at: string;
  updated_at: string;
};

export type BookerOwnerType = 'agency' | 'client';

export async function getBookersForAgency(agencyId: string): Promise<Booker[]> {
  const { data, error } = await supabase
    .from('bookers')
    .select('*')
    .eq('agency_id', agencyId)
    .order('display_name');
  if (error) { console.error('getBookersForAgency error:', error); return []; }
  return (data ?? []) as Booker[];
}

export async function getBookersForClient(clientId: string): Promise<Booker[]> {
  const { data, error } = await supabase
    .from('bookers')
    .select('*')
    .eq('client_id', clientId)
    .order('display_name');
  if (error) { console.error('getBookersForClient error:', error); return []; }
  return (data ?? []) as Booker[];
}

export async function getBookerByUserId(userId: string): Promise<Booker | null> {
  const { data, error } = await supabase
    .from('bookers')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) { console.error('getBookerByUserId error:', error); return null; }
  return (data as Booker) ?? null;
}

export async function createBooker(booker: {
  agency_id?: string;
  client_id?: string;
  user_id?: string;
  display_name: string;
  email?: string;
  is_master?: boolean;
}): Promise<Booker | null> {
  const { data, error } = await supabase
    .from('bookers')
    .insert({
      agency_id: booker.agency_id || null,
      client_id: booker.client_id || null,
      user_id: booker.user_id || null,
      display_name: booker.display_name,
      email: booker.email || null,
      is_master: booker.is_master ?? false,
    })
    .select()
    .single();
  if (error) { console.error('createBooker error:', error); return null; }
  return data as Booker;
}

export async function updateBooker(bookerId: string, fields: Partial<Pick<Booker, 'display_name' | 'email' | 'is_master'>>): Promise<boolean> {
  const { error } = await supabase
    .from('bookers')
    .update({ ...fields })
    .eq('id', bookerId);
  if (error) { console.error('updateBooker error:', error); return false; }
  return true;
}

export async function deleteBooker(bookerId: string): Promise<boolean> {
  const { error } = await supabase
    .from('bookers')
    .delete()
    .eq('id', bookerId);
  if (error) { console.error('deleteBooker error:', error); return false; }
  return true;
}

/**
 * Links an existing booker record to a Supabase auth user.
 * Called after the booker signs up and logs in with the email matching their booker profile.
 */
export async function linkBookerToAuthUser(email: string): Promise<Booker | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: booker, error: findErr } = await supabase
    .from('bookers')
    .select('*')
    .eq('email', email)
    .is('user_id', null)
    .maybeSingle();
  if (findErr || !booker) return null;

  const { error: updateErr } = await supabase
    .from('bookers')
    .update({ user_id: user.id })
    .eq('id', booker.id);
  if (updateErr) { console.error('linkBookerToAuthUser error:', updateErr); return null; }

  return { ...booker, user_id: user.id } as Booker;
}

export async function updateBookerStats(bookerId: string): Promise<void> {
  const { data: booker } = await supabase
    .from('bookers')
    .select('bookings_completed')
    .eq('id', bookerId)
    .single();
  if (booker) {
    await supabase
      .from('bookers')
      .update({ bookings_completed: (booker.bookings_completed ?? 0) + 1 })
      .eq('id', bookerId);
  }
}

export async function getBookerStats(ownerId: string, ownerType: BookerOwnerType = 'agency'): Promise<{
  bookers: (Booker & { active_options: number })[];
}> {
  const bookers = ownerType === 'agency'
    ? await getBookersForAgency(ownerId)
    : await getBookersForClient(ownerId);
  return {
    bookers: bookers.map(b => ({ ...b, active_options: 0 })),
  };
}
