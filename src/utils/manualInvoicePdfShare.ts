/**
 * Platform-aware PDF handoff: web keeps download; native writes to cache and
 * uses the OS share sheet (no iframe / blob URL navigation).
 */

import { File, Paths } from 'expo-file-system';
import { Platform, Share } from 'react-native';

import { downloadManualInvoicePdf } from './manualInvoicePdf';

function safePdfFilename(name: string): string {
  const base = name.trim() || 'invoice.pdf';
  return base.endsWith('.pdf')
    ? base.replace(/[^\w.\-]+/g, '_')
    : `${base.replace(/[^\w.\-]+/g, '_')}.pdf`;
}

/**
 * Web: trigger download. Native: write PDF to cache and open share sheet.
 */
export async function shareOrDownloadManualInvoicePdf(
  blob: Blob,
  filename: string,
): Promise<{ ok: boolean }> {
  if (Platform.OS === 'web') {
    downloadManualInvoicePdf(blob, filename);
    return { ok: true };
  }
  try {
    const ab = await blob.arrayBuffer();
    const bytes = new Uint8Array(ab);
    const safeName = safePdfFilename(filename);
    const outFile = new File(Paths.cache, safeName);
    outFile.write(bytes);
    const url = outFile.uri.startsWith('file://') ? outFile.uri : `file://${outFile.uri}`;
    await Share.share({ title: safeName, url });
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
