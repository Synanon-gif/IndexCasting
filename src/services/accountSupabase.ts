import { supabase } from '../../lib/supabase';

/** Eigenes Konto zur Löschung anmelden. Daten bleiben 30 Tage archiviert, danach endgültig gelöscht. */
export async function requestAccountDeletion(): Promise<boolean> {
  const { error } = await supabase.rpc('request_account_deletion');
  if (error) {
    console.error('requestAccountDeletion error:', error);
    return false;
  }
  return true;
}

/** Löschwunsch zurückziehen (innerhalb der 30 Tage). */
export async function cancelAccountDeletion(): Promise<boolean> {
  const { error } = await supabase.rpc('cancel_account_deletion');
  if (error) {
    console.error('cancelAccountDeletion error:', error);
    return false;
  }
  return true;
}
