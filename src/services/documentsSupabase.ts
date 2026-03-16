import { supabase } from '../../lib/supabase';

/**
 * Nutzerdokumente (Verträge, Rechnungen, Ausweise) – Supabase Storage + documents-Tabelle.
 * Pro Partei: owner_id = userId; Pfad documents/{userId}/…; alle Daten persistent.
 */
export type Document = {
  id: string;
  owner_id: string;
  type: 'contract' | 'invoice' | 'id_document';
  file_path: string;
  encrypted: boolean;
  created_at: string;
};

export async function getDocumentsForUser(userId: string): Promise<Document[]> {
  const { data, error } = await supabase
    .from('documents')
    .select('*')
    .eq('owner_id', userId)
    .order('created_at', { ascending: false });
  if (error) { console.error('getDocumentsForUser error:', error); return []; }
  return (data ?? []) as Document[];
}

export async function uploadDocument(
  userId: string,
  docType: 'contract' | 'invoice' | 'id_document',
  file: File | Blob,
  fileName: string
): Promise<Document | null> {
  const path = `documents/${userId}/${Date.now()}_${fileName}`;

  const { error: uploadError } = await supabase.storage
    .from('documents')
    .upload(path, file);
  if (uploadError) { console.error('uploadDocument storage error:', uploadError); return null; }

  const { data, error } = await supabase
    .from('documents')
    .insert({
      owner_id: userId,
      type: docType,
      file_path: path,
      encrypted: false,
    })
    .select()
    .single();
  if (error) { console.error('uploadDocument db error:', error); return null; }
  return data as Document;
}

export async function getDocumentUrl(filePath: string): Promise<string | null> {
  const { data } = await supabase.storage
    .from('documents')
    .createSignedUrl(filePath, 3600);
  return data?.signedUrl ?? null;
}

export async function deleteDocument(docId: string, filePath: string): Promise<boolean> {
  await supabase.storage.from('documents').remove([filePath]);
  const { error } = await supabase.from('documents').delete().eq('id', docId);
  if (error) { console.error('deleteDocument error:', error); return false; }
  return true;
}
