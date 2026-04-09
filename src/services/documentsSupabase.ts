import { supabase } from '../../lib/supabase';
import { checkAndIncrementStorage, decrementStorage } from './agencyStorageSupabase';
import { validateFile, checkMagicBytes, checkExtensionConsistency, sanitizeUploadBaseName } from '../../lib/validation';
import { convertHeicToJpegWithStatus } from './imageUtils';

/** Reads the actual stored file size from storage.objects metadata. Best-effort — returns null on failure. */
async function getActualDocumentSize(bucket: string, path: string): Promise<number | null> {
  try {
    const folder = path.substring(0, path.lastIndexOf('/'));
    const filename = path.substring(path.lastIndexOf('/') + 1);
    const { data, error } = await supabase.storage.from(bucket).list(folder, { search: filename });
    if (error || !data?.length) return null;
    const size = data[0]?.metadata?.size;
    return typeof size === 'number' ? size : null;
  } catch {
    return null;
  }
}

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
  /** Actual file size stored at upload time. Used for reliable storage decrement. */
  file_size_bytes?: number;
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
  const { file: prepared, conversionFailed } = await convertHeicToJpegWithStatus(file);
  if (conversionFailed) {
    console.error('uploadDocument: HEIC/HEIF conversion failed');
    return null;
  }

  const claimedSize = prepared instanceof File ? prepared.size : (prepared as Blob).size;

  // MIME type and size validation before any storage interaction.
  const fileValidation = validateFile(prepared);
  if (!fileValidation.ok) {
    console.error('uploadDocument: file validation failed', fileValidation.error);
    return null;
  }

  // Magic-byte check: verifies actual file content matches declared MIME type.
  // Prevents renamed executables from being stored as PDFs or images.
  const magicCheck = await checkMagicBytes(prepared);
  if (!magicCheck.ok) {
    console.error('uploadDocument: magic bytes check failed', magicCheck.error);
    return null;
  }

  if (prepared instanceof File) {
    const extCheck = checkExtensionConsistency(prepared);
    if (!extCheck.ok) {
      console.error('uploadDocument: extension/MIME mismatch', extCheck.error);
      return null;
    }
  }

  const nameSource = prepared instanceof File ? prepared.name : fileName;
  const safeFileName = sanitizeUploadBaseName(nameSource);
  const path = `documents/${userId}/${Date.now()}_${safeFileName}`;

  // Agency storage limit check — non-agency users pass through automatically.
  const storageCheck = await checkAndIncrementStorage(claimedSize);
  if (!storageCheck.allowed) {
    console.warn('uploadDocument: storage limit reached', storageCheck);
    return null;
  }

  const { error: uploadError } = await supabase.storage
    .from('documents')
    .upload(path, prepared, {
      contentType: prepared.type || 'application/octet-stream',
      upsert: false,
    });
  if (uploadError) {
    console.error('uploadDocument storage error:', uploadError);
    await decrementStorage(claimedSize);
    return null;
  }

  // BUG 3 FIX: verify actual size server-side and reconcile with the pre-increment.
  const actualSize = await getActualDocumentSize('documents', path) ?? claimedSize;
  if (actualSize !== claimedSize) {
    if (actualSize > claimedSize) {
      const driftResult = await checkAndIncrementStorage(actualSize - claimedSize);
      if (!driftResult.allowed) {
        console.warn('[storage] uploadDocument: post-upload size drift exceeded limit — counter undercounted', { actualSize, claimedSize });
      }
    } else {
      await decrementStorage(claimedSize - actualSize);
    }
  }

  // Supabase Storage applies AES-256 server-side encryption to all objects.
  const { data, error } = await supabase
    .from('documents')
    .insert({
      owner_id: userId,
      type: docType,
      file_path: path,
      encrypted: true,
      file_size_bytes: actualSize,
    })
    .select()
    .single();

  if (error) {
    console.error('uploadDocument db error:', error);
    // Storage-Orphan cleanup: the file was uploaded successfully but the DB row
    // failed. Remove the storage object to keep Storage and DB in sync.
    const { error: removeErr } = await supabase.storage.from('documents').remove([path]);
    if (removeErr) {
      console.error('uploadDocument orphan cleanup failed — manual removal needed:', { path, removeErr });
    } else {
      await decrementStorage(actualSize);
    }
    return null;
  }

  return data as Document;
}

export async function getDocumentUrl(userId: string, filePath: string): Promise<string | null> {
  const expectedPrefix = `documents/${userId}/`;
  if (!filePath.startsWith(expectedPrefix)) {
    console.error('getDocumentUrl: filePath does not belong to userId — IDOR blocked', { filePath, userId });
    return null;
  }
  const { data } = await supabase.storage
    .from('documents')
    .createSignedUrl(filePath, 3600);
  return data?.signedUrl ?? null;
}

/**
 * Deletes a document from Storage and the documents table, then decrements storage usage.
 *
 * BUG 1 FIX: reads file_size_bytes from the DB row before deletion instead of
 * using a fragile storage.list() call. Guarantees reliable decrement.
 */
export async function deleteDocument(docId: string, filePath: string): Promise<boolean> {
  try {
    // Read the stored file size from DB — always reliable, no storage.list() needed.
    const { data: docRow } = await supabase
      .from('documents')
      .select('file_size_bytes')
      .eq('id', docId)
      .maybeSingle();
    const freedBytes: number = (docRow as { file_size_bytes?: number } | null)?.file_size_bytes ?? 0;

    // Remove from Storage first and verify success before deleting the DB row.
    // If the order were reversed and the Storage removal failed after DB delete,
    // we would have an orphaned file with no DB reference (unreachable, wasted space).
    // In the current order a Storage failure leaves the DB row intact — the
    // document remains accessible and a retry is possible.
    const { error: storageError } = await supabase.storage
      .from('documents')
      .remove([filePath]);

    if (storageError) {
      console.error('deleteDocument storage error:', storageError);
      return false;
    }

    const { error: dbError } = await supabase
      .from('documents')
      .delete()
      .eq('id', docId);

    if (dbError) {
      console.error('deleteDocument db error:', dbError);
      return false;
    }

    // Decrement with the DB-stored size (may be 0 for legacy rows, which is safe).
    if (freedBytes > 0) {
      await decrementStorage(freedBytes);
    }

    return true;
  } catch (e) {
    console.error('deleteDocument exception:', e);
    return false;
  }
}
